import * as vscode from 'vscode';
import { getHvigorwPath, getOhosBaseSdkHome } from '@oniroproject/core';
import { vscodeConfigProvider } from '../adapters';

export class OniroTaskProvider implements vscode.TaskProvider {
  static OniroType = 'oniro';

  provideTasks(): vscode.Task[] {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) { return []; }
    const projectDir = workspaceFolders[0].uri.fsPath;
    const env = { ...process.env, OHOS_BASE_SDK_HOME: getOhosBaseSdkHome(vscodeConfigProvider) };
    const hvigorwPath = getHvigorwPath(vscodeConfigProvider, projectDir);

    const tasks: vscode.Task[] = [];

    tasks.push(new vscode.Task(
      { type: OniroTaskProvider.OniroType },
      vscode.TaskScope.Workspace,
      'build',
      'oniro',
      new vscode.ShellExecution(
        `${hvigorwPath} assembleHap --mode module -p product=default --stacktrace --no-parallel --no-daemon`,
        { cwd: projectDir, env },
      ),
      [],
    ));

    return tasks;
  }

  resolveTask(_task: vscode.Task): vscode.Task | undefined {
    return undefined;
  }
}
