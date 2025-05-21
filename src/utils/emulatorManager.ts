import { exec } from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { oniroLogChannel } from './logger';
import { getEmulatorDir } from './sdkUtils';

const emulatorChannel = oniroLogChannel;
const PID_FILE = '/tmp/oniro_emulator.pid';

function execPromise(cmd: string, cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd }, (error, stdout, stderr) => {
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
  // Check if emulator is already running
  if (fs.existsSync(PID_FILE)) {
    try {
      const pid = fs.readFileSync(PID_FILE, 'utf8').trim();
      if (pid && !isNaN(Number(pid))) {
        // Check if process is running
        try {
          process.kill(Number(pid), 0);
          vscode.window.showWarningMessage('Emulator is already running.');
          emulatorChannel.appendLine(`Emulator already running with PID ${pid}.`);
          return;
        } catch (e) {
          // Process not running, continue to start emulator
        }
      }
    } catch (err) {
      emulatorChannel.appendLine(`WARNING: Could not read PID file: ${(err as Error).message}`);
    }
  }
  // Start emulator in background and store PID
  const emulatorImagesPath = path.join(getEmulatorDir(), 'images');
  await execPromise(`(./run.sh & echo $! > ${PID_FILE})`, emulatorImagesPath);
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
