import { exec } from 'child_process';

function execPromise(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (stdout) console.log(`[hdc] stdout: ${stdout.trim()}`);
      if (stderr) console.error(`[hdc] stderr: ${stderr.trim()}`);
      if (error) {
        console.error(`[hdc] error: ${error.message}`);
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Install a HAP package to device/emulator via HDC
 */
export function installApp(hapPath: string): Promise<void> {
  return execPromise(`hdc install ${hapPath}`);
}

/**
 * Launch an installed bundle on device/emulator via HDC
 */
export function launchApp(bundleName: string): Promise<void> {
  return execPromise(`hdc shell aa start -a EntryAbility -b ${bundleName}`);
}