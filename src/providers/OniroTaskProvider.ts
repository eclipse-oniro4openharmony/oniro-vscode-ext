import * as vscode from 'vscode';

export class OniroTaskProvider implements vscode.TaskProvider {
    static OniroType = 'oniro';

    provideTasks(): vscode.ProviderResult<vscode.Task[]> {
        const tasks: vscode.Task[] = [];
        const kind = { type: OniroTaskProvider.OniroType, command: 'init' };
        tasks.push(new vscode.Task(
            kind,
            vscode.TaskScope.Workspace,
            'initSDK',
            OniroTaskProvider.OniroType,
            new vscode.ShellExecution('onirobuilder init'),
            []
        ));
        const buildKind = { type: OniroTaskProvider.OniroType, command: 'build' };
        tasks.push(new vscode.Task(
            buildKind,
            vscode.TaskScope.Workspace,
            'buildApp',
            OniroTaskProvider.OniroType,
            new vscode.ShellExecution('onirobuilder build'),
            []
        ));
        return tasks;
    }

    resolveTask(task: vscode.Task): vscode.ProviderResult<vscode.Task> {
        return undefined;
    }
}