import { exec } from 'child_process';
import * as vscode from 'vscode';

const emulatorChannel = vscode.window.createOutputChannel('Emulator Manager');

function execPromise(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (stdout) emulatorChannel.appendLine(`[emulator] stdout: ${stdout.trim()}`);
      if (stderr) emulatorChannel.appendLine(`[emulator] stderr: ${stderr.trim()}`);
      if (error) {
        emulatorChannel.appendLine(`ERROR: [emulator] error: ${error.message}`);
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export function startEmulator(): Promise<void> {
  return execPromise('onirobuilder emulator');
}

export function stopEmulator(): Promise<void> {
  return execPromise('onirobuilder emulator --stop');
}

export function connectEmulator(): Promise<void> {
  return execPromise('hdc start -r && hdc tconn localhost:55555');
}
