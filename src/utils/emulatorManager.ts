import { exec } from 'child_process';

function execPromise(cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    exec(cmd, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function startEmulator(): Promise<void> {
  return execPromise('onirobuilder emulator');
}

export function stopEmulator(): Promise<void> {
  return execPromise('onirobuilder emulator --stop');
}
