import { exec } from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const emulatorChannel = vscode.window.createOutputChannel('Emulator Manager');
const PID_FILE = '/tmp/oniro_emulator.pid';

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

async function attemptHdcConnection(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    exec('hdc start -r && hdc tconn 127.0.0.1:55555', (error, stdout, stderr) => {
      if (stdout) emulatorChannel.appendLine(`[emulator] stdout: ${stdout.trim()}`);
      if (stderr) emulatorChannel.appendLine(`[emulator] stderr: ${stderr.trim()}`);
      resolve(!error && stdout.includes('Connect OK'));
    });
  });
}

export async function startEmulator(): Promise<void> {
  // Start emulator in background and store PID
  await execPromise(`(onirobuilder emulator > /dev/null 2>&1 & echo $! > ${PID_FILE})`);
  emulatorChannel.appendLine(`Emulator started in background. PID stored in ${PID_FILE}`);
  while (true) {
    if (await attemptHdcConnection()) {
      emulatorChannel.appendLine('HDC connected.');
      break;
    }
    emulatorChannel.appendLine('Waiting for HDC connection...');
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

export function stopEmulator(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Kill all qemu-system-x86_64 processes
    exec('pkill -f qemu-system-x86_64', (error, stdout, stderr) => {
      if (stdout) emulatorChannel.appendLine(`[emulator] stdout: ${stdout.trim()}`);
      if (stderr) emulatorChannel.appendLine(`[emulator] stderr: ${stderr.trim()}`);
      if (error) {
        emulatorChannel.appendLine(`ERROR: Failed to kill qemu-system-x86_64 processes: ${error.message}`);
        return reject(error);
      }
      emulatorChannel.appendLine('All qemu-system-x86_64 processes killed.');
      // Remove the PID file if it exists
      fs.unlink(PID_FILE, (unlinkErr) => {
        if (unlinkErr && unlinkErr.code !== 'ENOENT') {
          emulatorChannel.appendLine(`WARNING: Could not remove PID file: ${unlinkErr.message}`);
        }
        resolve();
      });
    });
  });
}

export function connectEmulator(): Promise<void> {
  return execPromise('hdc start -r && hdc tconn localhost:55555');
}
