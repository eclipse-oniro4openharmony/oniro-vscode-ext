import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getOhosBaseSdkHome, getCmdToolsPath } from './utils/sdkUtils';

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
    const env = { ...process.env, OHOS_BASE_SDK_HOME: getOhosBaseSdkHome() };
    const hvigorwPath = getHvigorwPath(projectDir);

    const tasks: vscode.Task[] = [];

    // Build Task only
    tasks.push(new vscode.Task(
      { type: OniroTaskProvider.OniroType },
      vscode.TaskScope.Workspace,
      'build',
      'oniro',
      new vscode.ShellExecution(`${hvigorwPath} assembleHap --mode module -p product=default --stacktrace --no-parallel --no-daemon`, { cwd: projectDir, env }),
      []
    ));

    return tasks;
  }

  resolveTask(_task: vscode.Task): vscode.Task | undefined {
    // Not implemented (static tasks only)
    return undefined;
  }
}
