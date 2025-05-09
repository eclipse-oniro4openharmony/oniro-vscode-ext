import { exec } from 'child_process';

function execPromise(cmd: string): Promise<void> {
  console.debug(`[onirobuilder] executing command: ${cmd}`);
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout: string, stderr: string) => {
      console.debug(`[onirobuilder] stdout: ${stdout}`);
      console.debug(`[onirobuilder] stderr: ${stderr}`);
      if (error) {
        console.error(`[onirobuilder] command failed: ${error.message}`);
        reject(new Error(`Command "${cmd}" failed: ${error.message}\nStdout: ${stdout}\nStderr: ${stderr}`));
      } else {
        console.debug(`[onirobuilder] command succeeded`);
        resolve();
      }
    });
  });
}

export function onirobuilderInit(version?: string): Promise<void> {
  console.debug(`[onirobuilder] onirobuilderInit called with version: ${version}`);
  const sdkFlag = version ? `--sdk-version ${version}` : '';
  return execPromise(`onirobuilder init ${sdkFlag}`);
}

export function onirobuilderBuild(): Promise<void> {
  console.debug(`[onirobuilder] onirobuilderBuild called`);
  return execPromise('onirobuilder build');
}

export function onirobuilderSign(): Promise<void> {
  console.debug(`[onirobuilder] onirobuilderSign called`);
  return execPromise('onirobuilder sign');
}