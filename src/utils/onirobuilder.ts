import { exec } from 'child_process';
import * as vscode from 'vscode';
import { oniroLogChannel } from './logger';
import * as fs from 'fs';
import * as path from 'path';
import * as json5 from 'json5';

const workspaceFolders = vscode.workspace.workspaceFolders;
const projectDir = workspaceFolders && workspaceFolders.length > 0
  ? workspaceFolders[0].uri.fsPath
  : process.cwd();

const logChannel = oniroLogChannel;

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

export async function onirobuilderBuild(): Promise<void> {
  logChannel.appendLine(`[onirobuilder] onirobuilderBuild called`);
  // Check build-profile.json5 for signingConfigs
  const buildProfilePath = path.join(projectDir, 'build-profile.json5');
  if (fs.existsSync(buildProfilePath)) {
    try {
      const content = fs.readFileSync(buildProfilePath, 'utf8');
      const profile = json5.parse(content);
      if (
        !profile?.app?.signingConfigs ||
        !Array.isArray(profile.app.signingConfigs) ||
        profile.app.signingConfigs.length === 0
      ) {
        vscode.window.showWarningMessage(
          'No signing configs found in build-profile.json5. Please generate them first using the Oniro: Sign App command.'
        );
        throw new Error('Missing signing configs in build-profile.json5');
      }
    } catch (err) {
      logChannel.appendLine(`[onirobuilder] Error reading/parsing build-profile.json5: ${err}`);
      vscode.window.showWarningMessage(
        'Could not read or parse build-profile.json5. Please ensure it exists and is valid, and generate signing configs if needed.'
      );
      throw err;
    }
  } else {
    vscode.window.showWarningMessage(
      'build-profile.json5 not found. Please generate signing configs first using the Oniro: Sign App command.'
    );
    throw new Error('build-profile.json5 not found');
  }
  return execPromise('onirobuilder build');
}

export function onirobuilderSign(): Promise<void> {
  logChannel.appendLine(`[onirobuilder] onirobuilderSign called`);
  return execPromise('onirobuilder sign');
}