import { exec } from 'child_process';
import * as vscode from 'vscode';
import { oniroLogChannel } from './logger';
import * as fs from 'fs';
import * as path from 'path';
import { getHdcPath } from './sdkUtils';

const hdcChannel = oniroLogChannel;

function execPromise(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (stdout) hdcChannel.appendLine(`[hdc] stdout: ${stdout.trim()}`);
      if (stderr) hdcChannel.appendLine(`[hdc] stderr: ${stderr.trim()}`);
      if (error) {
        hdcChannel.appendLine(`ERROR: [hdc] error: ${error.message}`);
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Helper to read JSON5 files (since app.json5/module.json5 are JSON5, not strict JSON)
 */
function readJson5File<T>(filePath: string): T {
  const json5 = require('json5');
  const content = fs.readFileSync(filePath, 'utf-8');
  return json5.parse(content);
}

/**
 * Automatically determines the bundleName from AppScope/app.json5
 */
export function getBundleName(projectDir: string): string {
  const appJsonPath = path.join(projectDir, 'AppScope', 'app.json5');
  if (!fs.existsSync(appJsonPath)) {
    throw new Error(`Could not find app.json5 at ${appJsonPath}`);
  }
  const appJson = readJson5File<{ app: { bundleName: string } }>(appJsonPath);
  if (!appJson.app?.bundleName) {
    throw new Error('bundleName not found in app.json5');
  }
  return appJson.app.bundleName;
}

/**
 * Automatically determines the main ability from entry/src/main/module.json5
 */
function getMainAbility(projectDir: string): string {
  const moduleJsonPath = path.join(projectDir, 'entry', 'src', 'main', 'module.json5');
  if (!fs.existsSync(moduleJsonPath)) {
    throw new Error(`Could not find module.json5 at ${moduleJsonPath}`);
  }
  const moduleJson = readJson5File<{ module: { mainElement: string } }>(moduleJsonPath);
  if (!moduleJson.module?.mainElement) {
    throw new Error('mainElement not found in module.json5');
  }
  return moduleJson.module.mainElement;
}

/**
 * Install a HAP package to device/emulator via HDC
 * Uses the configured .hap file path from workspace settings
 */
export async function installApp(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error('No workspace folder found.');
  }
  const projectDir = workspaceFolders[0].uri.fsPath;
  
  // Get the configured .hap path from workspace settings
  const config = vscode.workspace.getConfiguration('oniro');
  const relativeHapPath = config.get<string>('hapPath', 'entry/build/default/outputs/default/entry-default-signed.hap');
  const hapPath = path.join(projectDir, relativeHapPath);
  
  // Check if the file exists
  if (!fs.existsSync(hapPath)) {
    throw new Error(`HAP file not found at: ${hapPath}. Please build and sign your app first.`);
  }
  
  return execPromise(`${getHdcPath()} install "${hapPath}"`);
}

/**
 * Launch an installed bundle on device/emulator via HDC
 * Automatically determines bundleName and main ability from project files
 */
export async function launchApp(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error('No workspace folder found.');
  }
  const projectDir = workspaceFolders[0].uri.fsPath;
  const bundleName = getBundleName(projectDir);
  const mainAbility = getMainAbility(projectDir);
  return execPromise(`${getHdcPath()} shell aa start -a ${mainAbility} -b ${bundleName}`);
}

/**
 * Helper function to get running processes using hdc track-jpid
 * Can optionally filter by a target process name and return early
 */
function getRunningProcesses(
  targetProcessName?: string,
  timeout: number = 1000
): Promise<Array<{ pid: string; name: string }> | string> {
  return new Promise<Array<{ pid: string; name: string }> | string>((resolve, reject) => {
    const { spawn } = require('child_process');
    const proc = spawn(getHdcPath(), ['track-jpid']);
    const processes: Array<{ pid: string; name: string }> = [];
    let resolved = false;

    proc.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        const match = line.match(/^(\d+)\s+(.+)$/);
        if (match) {
          const pid = match[1];
          const name = match[2];
          processes.push({ pid, name });
          hdcChannel.appendLine(`[hdcManager] Found process: pid=${pid}, name=${name}`);
          
          // If we're looking for a specific process, return its PID immediately
          if (targetProcessName && name === targetProcessName) {
            hdcChannel.appendLine(`[hdcManager] Found matching process for bundle: ${targetProcessName} with pid: ${pid}`);
            if (!resolved) {
              resolved = true;
              proc.kill();
              resolve(pid);
              return;
            }
          }
        } else {
          hdcChannel.appendLine(`[hdcManager] No match for line: ${line}`);
        }
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      hdcChannel.appendLine(`[hdcManager] hdc track-jpid stderr: ${data.toString()}`);
    });

    proc.on('error', (err: any) => {
      if (!resolved) {
        resolved = true;
        hdcChannel.appendLine(`[hdcManager] hdc track-jpid process error: ${err}`);
        reject(err);
      }
    });

    // Set timeout and handle close event
    const timeoutHandle = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        if (targetProcessName) {
          reject(new Error(`Could not find process for bundle: ${targetProcessName}`));
        } else {
          resolve(processes);
        }
      }
    }, timeout);

    proc.on('close', (code: number) => {
      clearTimeout(timeoutHandle);
      if (!resolved) {
        resolved = true;
        if (targetProcessName) {
          reject(new Error(`Could not find process for bundle: ${targetProcessName}`));
        } else {
          resolve(processes);
        }
      }
    });
  });
}

/**
 * Get all running processes using hdc track-jpid
 */
export async function getAllRunningProcesses(): Promise<Array<{ pid: string; name: string }>> {
  const result = await getRunningProcesses();
  return result as Array<{ pid: string; name: string }>;
}

/**
 * Find the process ID (PID) of the running app by bundle name using hdc track-jpid
 */
export async function findAppProcessId(projectDir: string): Promise<string> {
  const bundleName = getBundleName(projectDir);
  const result = await getRunningProcesses(bundleName);
  return result as string;
}