import { exec } from 'child_process';
import * as vscode from 'vscode';
import { oniroLogChannel } from './logger';
import * as fs from 'fs';
import * as path from 'path';
import * as json5 from 'json5';
import { SDK_ROOT_DIR, CMD_TOOLS_PATH } from './sdkUtils';
import * as os from 'os';

const workspaceFolders = vscode.workspace.workspaceFolders;
const projectDir = workspaceFolders && workspaceFolders.length > 0
  ? workspaceFolders[0].uri.fsPath
  : process.cwd();

const logChannel = oniroLogChannel;

function execPromise(cmd: string, opts?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<void> {
  logChannel.appendLine(`[onirobuilder] executing command: ${cmd}`);
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd: opts?.cwd ?? projectDir, env: opts?.env }, (error, stdout: string, stderr: string) => {
      if (stdout && stdout.trim().length > 0) {
        logChannel.appendLine(`[onirobuilder] stdout: ${stdout}`);
      }
      if (stderr && stderr.trim().length > 0) {
        logChannel.appendLine(`[onirobuilder] stderr: ${stderr}`);
      }
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

// Determine OS folder for SDK path
function getOsFolder(): string {
  const platform = os.platform();
  if (platform === 'linux') return 'linux';
  if (platform === 'darwin') return 'darwin';
  if (platform === 'win32') return 'windows';
  throw new Error('Unsupported OS');
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

  // Set up environment variables
  const osFolder = getOsFolder();
  const env = { ...process.env, OHOS_BASE_SDK_HOME: path.join(SDK_ROOT_DIR, osFolder) };
  const cmdToolsBin = path.join(CMD_TOOLS_PATH, 'bin');
  const ohpmPath = path.join(cmdToolsBin, 'ohpm');
  let hvigorwPath = path.join(projectDir, 'hvigorw');
  if (!fs.existsSync(hvigorwPath)) {
    hvigorwPath = path.join(cmdToolsBin, 'hvigorw');
  }

  // Ensure hvigorw is executable
  try {
    fs.chmodSync(hvigorwPath, 0o755);
  } catch (e) {
    logChannel.appendLine(`[onirobuilder] WARNING: Could not chmod hvigorw: ${e}`);
  }

  // Install dependencies
  logChannel.appendLine(`[onirobuilder] Installing dependencies with ohpm...`);
  await execPromise(`${ohpmPath} install --all`, { cwd: projectDir, env });

  // Build steps
  logChannel.appendLine(`[onirobuilder] Running hvigorw --version --accept-license...`);
  await execPromise(`${hvigorwPath} --version --accept-license`, { cwd: projectDir, env });

  logChannel.appendLine(`[onirobuilder] Running hvigorw clean...`);
  await execPromise(`${hvigorwPath} clean --no-parallel --no-daemon`, { cwd: projectDir, env });

  logChannel.appendLine(`[onirobuilder] Running hvigorw assembleHap...`);
  await execPromise(`${hvigorwPath} assembleHap --mode module -p product=default --stacktrace --no-parallel --no-daemon`, { cwd: projectDir, env });

  logChannel.appendLine(`[onirobuilder] Build Process Complete.`);
}

export function onirobuilderSign(): Promise<void> {
  logChannel.appendLine(`[onirobuilder] onirobuilderSign called`);
  return execPromise('onirobuilder sign');
}