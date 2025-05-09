import { exec } from 'child_process';
import * as vscode from 'vscode';

const workspaceFolders = vscode.workspace.workspaceFolders;
const projectDir = workspaceFolders && workspaceFolders.length > 0
  ? workspaceFolders[0].uri.fsPath
  : process.cwd();

const logChannel = vscode.window.createOutputChannel('OniroBuilder');

function execPromise(cmd: string): Promise<void> {
  logChannel.appendLine(`[onirobuilder] executing command: ${cmd}`);
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: projectDir }, (error, stdout: string, stderr: string) => {
      logChannel.appendLine(`[onirobuilder] stdout: ${stdout}`);
      logChannel.appendLine(`[onirobuilder] stderr: ${stderr}`);
      if (error) {
        logChannel.appendLine(`ERROR: [onirobuilder] command failed: ${error.message}`);
        reject(new Error(`Command "${cmd}" failed: ${error.message}\nStdout: ${stdout}\nStderr: ${stderr}`));
      } else {
        logChannel.appendLine(`[onirobuilder] command succeeded`);
        resolve();
      }
    });
  });
}

export function onirobuilderInit(version?: string): Promise<void> {
  logChannel.appendLine(`[onirobuilder] onirobuilderInit called with version: ${version}`);
  const sdkFlag = version ? `--sdk-version ${version}` : '';
  return execPromise(`onirobuilder init ${sdkFlag}`);
}

export function onirobuilderBuild(): Promise<void> {
  logChannel.appendLine(`[onirobuilder] onirobuilderBuild called`);
  return execPromise('onirobuilder build');
}

export function onirobuilderSign(): Promise<void> {
  logChannel.appendLine(`[onirobuilder] onirobuilderSign called`);
  return execPromise('onirobuilder sign');
}