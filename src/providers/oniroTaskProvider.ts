import * as vscode from 'vscode';
import { runBuild } from '../build';
import { runArktsCheck } from '../arktsCheck';
import { errorMessage, isOhosProject, tryGetWorkspaceRoot } from '../utils/project';

interface OniroTaskDefinition extends vscode.TaskDefinition {
    /** `build` or `checkArkts`. */
    command: string;
    product?: string;
    module?: string;
    buildMode?: string;
}

/** A terminal that runs one build or check through core and streams its output. */
class CorePseudoterminal implements vscode.Pseudoterminal {
    private readonly writeEmitter = new vscode.EventEmitter<string>();
    private readonly closeEmitter = new vscode.EventEmitter<number>();
    readonly onDidWrite = this.writeEmitter.event;
    readonly onDidClose = this.closeEmitter.event;
    private readonly cts = new vscode.CancellationTokenSource();

    constructor(private readonly def: OniroTaskDefinition, private readonly projectDir: string) {}

    private write(text: string): void {
        this.writeEmitter.fire(text.replace(/\r?\n/g, '\r\n'));
    }

    open(): void {
        void this.run();
    }

    close(): void {
        this.cts.cancel();
    }

    private async run(): Promise<void> {
        let code = 0;
        try {
            if (this.def.command === 'checkArkts') {
                this.write('Checking ArkTS…\n');
                const controller = new AbortController();
                this.cts.token.onCancellationRequested(() => controller.abort());
                const report = await runArktsCheck({ projectDir: this.projectDir, signal: controller.signal });
                if (!report?.completed) {
                    code = 2;
                } else {
                    for (const d of report.diagnostics) {
                        this.write(`${d.file ?? ''}${d.line ? `:${d.line}:${d.column ?? 1}` : ''} ${d.severity} ${d.rule ?? d.code ?? ''} ${d.message}\n`);
                    }
                    this.write(`\n${report.summary.errors} error(s), ${report.summary.warnings} warning(s).\n`);
                    code = report.ok ? 0 : 1;
                }
            } else {
                const report = await runBuild({
                    projectDir: this.projectDir,
                    product: this.def.product,
                    module: this.def.module,
                    buildMode: this.def.buildMode,
                    token: this.cts.token,
                });
                if (report) {
                    this.write(`\nBuild passed in ${(report.durationMs / 1000).toFixed(1)} s. Output is in the Oniro Log.\n`);
                } else {
                    code = 1;
                }
            }
        } catch (err) {
            this.write(`\n${errorMessage(err)}\n`);
            code = 1;
        }
        this.closeEmitter.fire(code);
    }
}

/**
 * `oniro` tasks. They run through core (hvigor via `buildWithDiagnostics`, the ArkTS
 * checker via `checkArkts`), so their findings land in the Problems panel without a
 * problem matcher.
 */
export class OniroTaskProvider implements vscode.TaskProvider {
    static readonly OniroType = 'oniro';

    private makeTask(def: OniroTaskDefinition, scope: vscode.WorkspaceFolder | vscode.TaskScope, projectDir: string): vscode.Task {
        const name = def.command === 'checkArkts' ? 'check ArkTS' : `build${def.product ? ` ${def.product}` : ''}`;
        const task = new vscode.Task(
            def,
            scope,
            name,
            OniroTaskProvider.OniroType,
            new vscode.CustomExecution(async () => new CorePseudoterminal(def, projectDir)),
            [],
        );
        if (def.command !== 'checkArkts') {
            task.group = vscode.TaskGroup.Build;
        }
        return task;
    }

    provideTasks(): vscode.Task[] {
        const projectDir = tryGetWorkspaceRoot();
        if (!isOhosProject(projectDir)) { return []; }
        const scope = vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === projectDir) ?? vscode.TaskScope.Workspace;
        return [
            this.makeTask({ type: OniroTaskProvider.OniroType, command: 'build' }, scope, projectDir),
            this.makeTask({ type: OniroTaskProvider.OniroType, command: 'checkArkts' }, scope, projectDir),
        ];
    }

    resolveTask(task: vscode.Task): vscode.Task | undefined {
        const def = task.definition as OniroTaskDefinition;
        const projectDir = tryGetWorkspaceRoot();
        if (!def.command || !isOhosProject(projectDir)) { return undefined; }
        return this.makeTask(def, task.scope ?? vscode.TaskScope.Workspace, projectDir);
    }
}
