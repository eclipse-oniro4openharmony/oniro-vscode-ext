import { exec } from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { oniroLogChannel } from './logger';
import { getEmulatorDir, getHdcPath } from './sdkUtils';

const emulatorChannel = oniroLogChannel;
const PID_FILE = '/tmp/oniro_emulator.pid';

/**
 * Execute a shell command and log output.
 */
function execPromise(cmd: string, cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd }, (error, stdout, stderr) => {
      if (stdout?.trim()) emulatorChannel.appendLine(`[emulator] stdout: ${stdout.trim()}`);
      if (stderr?.trim()) emulatorChannel.appendLine(`[emulator] stderr: ${stderr.trim()}`);
      if (error) {
        emulatorChannel.appendLine(`ERROR: [emulator] error: ${error.message}`);
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Try to connect HDC to the emulator.
 * Returns true if connection is successful, false otherwise.
 */
export async function attemptHdcConnection(address: string = '127.0.0.1:55555'): Promise<boolean> {
  try {
    // Start hdc server and try to connect
    await execPromise(`${getHdcPath()} start -r`);
    await execPromise(`${getHdcPath()} tconn ${address}`);
    // Check connection status
    let connected = false;
    await new Promise<void>((resolve) => {
      exec(`${getHdcPath()} list targets`, (error, stdout, stderr) => {
        if (stdout?.includes(address)) {
          connected = true;
        }
        resolve();
      });
    });
    return connected;
  } catch (err) {
    emulatorChannel.appendLine(`ERROR: HDC connection attempt failed: ${(err as Error).message}`);
    return false;
  }
}

export async function startEmulator(): Promise<void> {
  // Check if qemu-system-x86_64 is available
  const qemuAvailable = await new Promise<boolean>((resolve) => {
    exec('which qemu-system-x86_64', (error, stdout) => {
      if (error || !stdout.trim()) {
        emulatorChannel.appendLine('ERROR: qemu-system-x86_64 not found in PATH.');
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
  if (!qemuAvailable) {
    throw new Error('qemu-system-x86_64 not found in PATH.');
  }

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
  try {
    await execPromise(`(./run.sh > /dev/null 2>&1 & echo $! > ${PID_FILE})`, emulatorImagesPath);
    emulatorChannel.appendLine(`Emulator started in background. PID stored in ${PID_FILE}`);
  } catch (err) {
    emulatorChannel.appendLine(`ERROR: Failed to start emulator: ${(err as Error).message}`);
    throw new Error('Failed to start emulator.');
  }

  // Show progress while waiting for HDC connection
  await vscode.window.withProgress({
    title: 'Oniro Emulator: Connecting HDC',
    location: vscode.ProgressLocation.Notification,
    cancellable: true
  }, async (progress, token) => {
    while (true) {
      if (token.isCancellationRequested) {
        emulatorChannel.appendLine('HDC connection cancelled by user.');
        return;
      }
      progress.report({ message: `Waiting for HDC connection...` });
      if (await attemptHdcConnection()) {
        vscode.window.showInformationMessage('HDC connected!');
        break;
      }
      emulatorChannel.appendLine('Waiting for HDC connection...');
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  });
}

export function stopEmulator(): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      await execPromise('pkill -f qemu-system-x86_64');
      emulatorChannel.appendLine('All qemu-system-x86_64 processes killed.');
      // Remove the PID file if it exists
      fs.unlink(PID_FILE, (unlinkErr) => {
        if (unlinkErr && unlinkErr.code !== 'ENOENT') {
          emulatorChannel.appendLine(`WARNING: Could not remove PID file: ${unlinkErr.message}`);
        }
        resolve();
      });
    } catch (error) {
      emulatorChannel.appendLine(`ERROR: Failed to kill qemu-system-x86_64 processes: ${(error as Error).message}`);
      reject(error);
    }
  });
}
