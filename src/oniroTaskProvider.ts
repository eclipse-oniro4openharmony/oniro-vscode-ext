import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getSdkRootDir, getCmdToolsPath } from './utils/sdkUtils';
import * as os from 'os';

function getOsFolder(): string {
  const platform = os.platform();
  if (platform === 'linux') return 'linux';
  if (platform === 'darwin') return 'darwin';
  if (platform === 'win32') return 'windows';
  throw new Error('Unsupported OS');
}

function getHvigorwPath(projectDir: string): string {
  const cmdToolsBin = path.join(getCmdToolsPath(), 'bin');
  let hvigorwPath = path.join(projectDir, 'hvigorw');
  if (!fs.existsSync(hvigorwPath)) {
    hvigorwPath = path.join(cmdToolsBin, 'hvigorw');
  }
  return hvigorwPath;
}

export class OniroTaskProvider implements vscode.TaskProvider {
  static OniroType = 'oniro';

  provideTasks(): vscode.Task[] {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return [];
    const projectDir = workspaceFolders[0].uri.fsPath;
    const osFolder = getOsFolder();
    const env = { ...process.env, OHOS_BASE_SDK_HOME: path.join(getSdkRootDir(), osFolder) };
    const hvigorwPath = getHvigorwPath(projectDir);

    const tasks: vscode.Task[] = [];

    // Clean Task
    tasks.push(new vscode.Task(
      { type: OniroTaskProvider.OniroType, task: 'clean' },
      vscode.TaskScope.Workspace,
      'Oniro: Clean',
      'oniro',
      new vscode.ShellExecution(`${hvigorwPath} clean --no-parallel --no-daemon`, { cwd: projectDir, env }),
      []
    ));

    // Build Task
    tasks.push(new vscode.Task(
      { type: OniroTaskProvider.OniroType, task: 'assembleHap' },
      vscode.TaskScope.Workspace,
      'Oniro: Build (assembleHap)',
      'oniro',
      new vscode.ShellExecution(`${hvigorwPath} assembleHap --mode module -p product=default --stacktrace --no-parallel --no-daemon`, { cwd: projectDir, env }),
      []
    ));

    // Version/License Task
    tasks.push(new vscode.Task(
      { type: OniroTaskProvider.OniroType, task: 'version' },
      vscode.TaskScope.Workspace,
      'Oniro: Accept License',
      'oniro',
      new vscode.ShellExecution(`${hvigorwPath} --version --accept-license`, { cwd: projectDir, env }),
      []
    ));

    return tasks;
  }

  resolveTask(_task: vscode.Task): vscode.Task | undefined {
    // Not implemented (static tasks only)
    return undefined;
  }
}
