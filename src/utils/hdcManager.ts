import { exec } from 'child_process';
import * as vscode from 'vscode';
import { oniroLogChannel } from './logger';
import * as fs from 'fs';
import * as path from 'path';

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
 */
export function launchApp(bundleName: string): Promise<void> {
  return execPromise(`hdc shell aa start -a EntryAbility -b ${bundleName}`);
}