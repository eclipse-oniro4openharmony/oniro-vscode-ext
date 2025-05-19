import { exec } from 'child_process';
import * as vscode from 'vscode';
import { oniroLogChannel } from './logger';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

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
 * Automatically detects the signed .hap file in entry/build/default/outputs/default/
 */
export async function installApp(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    throw new Error('No workspace folder found.');
  }
  const projectDir = workspaceFolders[0].uri.fsPath;
  const hapDir = path.join(projectDir, 'entry', 'build', 'default', 'outputs', 'default');
  let hapFile: string | undefined;
  try {
    const files = fs.readdirSync(hapDir);
    hapFile = files.find(f => f.endsWith('-signed.hap'));
  } catch (err) {
    throw new Error(`Could not read directory: ${hapDir}`);
  }
  if (!hapFile) {
    throw new Error('No signed .hap file found in entry/build/default/outputs/default/. Please build and sign your app first.');
  }
  const hapPath = path.join(hapDir, hapFile);
  return execPromise(`hdc install "${hapPath}"`);
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
  return execPromise(`hdc shell aa start -a ${mainAbility} -b ${bundleName}`);
}

/**
 * Find the process ID (PID) of the running app by bundle name using hdc track-jpid
 */
export async function findAppProcessId(projectDir: string): Promise<string> {
  const bundleName = getBundleName(projectDir);
  return new Promise<string>((resolve, reject) => {
    const { spawn } = require('child_process');
    const proc = spawn('hdc', ['track-jpid']);
    proc.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        const match = line.match(/^(\d+)\s+(.+)$/);
        if (match) {
          const pid = match[1];
          const name = match[2];
          hdcChannel.appendLine(`[hdcManager] Found process: pid=${pid}, name=${name}`);
          if (name === bundleName) {
            hdcChannel.appendLine(`[hdcManager] Found matching process for bundle: ${bundleName} with pid: ${pid}`);
            proc.kill();
            resolve(pid);
            return;
          }
        } else {
          hdcChannel.appendLine(`[hdcManager] No match for line: ${line}`);
        }
      }
    });
    proc.stderr.on('data', (data: Buffer) => {
      hdcChannel.appendLine(`[hdcManager] hdc track-jpid stderr: ${data.toString()}`);
    });
    proc.on('close', (code: number) => {
      reject(new Error('Could not find process for bundle: ' + bundleName));
    });
    proc.on('error', (err: any) => {
      hdcChannel.appendLine(`[hdcManager] hdc track-jpid process error: ${err}`);
      reject(err);
    });
  });
}