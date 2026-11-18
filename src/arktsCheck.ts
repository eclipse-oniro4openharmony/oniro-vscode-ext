import * as path from 'path';
import * as vscode from 'vscode';
import {
    type ArktsCheckReport,
    SdkNotInstalledError,
    checkArkts,
} from '@oniroproject/core';
import { tokenToSignal, vscodeConfigProvider, vscodeLogger } from './adapters';
import { OniroDiagnostics, publishDiagnostics } from './diagnostics';
import { installSdkWithProgress } from './sdkInstall';
import { oniroLogChannel } from './utils/logger';
import { errorMessage, getProjectDir, isCancellation, isOhosProject } from './utils/project';

let diagnostics: OniroDiagnostics | undefined;
/** The running on-save check, so a newer save supersedes it. */
/** Running on-save checks by document: saving one file only supersedes its own check. */
const onSaveRuns = new Map<string, AbortController>();

function summarize(r: ArktsCheckReport): string {
    const { errors, warnings, fixed } = r.summary;
    const parts = [`${errors} error${errors === 1 ? '' : 's'}`, `${warnings} warning${warnings === 1 ? '' : 's'}`];
    if (fixed) { parts.push(`${fixed} fixed`); }
    return parts.join(', ');
}

/**
 * Run core's `check arkts` (the SDK's own ArkTS type check and linter plus the ArkUI
 * rules hvigor enforces later) and publish the findings. Resolves with the report, or
 * undefined when it could not run (the user has been told why).
 */
export async function runArktsCheck(opts: {
    projectDir: string;
    files?: string[];
    fix?: boolean;
    signal?: AbortSignal;
    quiet?: boolean;
}): Promise<ArktsCheckReport | undefined> {
    let report: ArktsCheckReport;
    try {
        report = await checkArkts({
            config: vscodeConfigProvider,
            projectDir: opts.projectDir,
            files: opts.files,
            fix: opts.fix,
            abortSignal: opts.signal,
            logger: vscodeLogger,
        });
    } catch (err) {
        if (isCancellation(err)) { return undefined; }
        if (err instanceof SdkNotInstalledError && !opts.quiet) {
            const action = err.version ? `Install SDK ${err.version}` : undefined;
            const choice = await vscode.window.showErrorMessage(
                `ArkTS check needs OpenHarmony API ${err.api}, which is not installed.`,
                ...(action ? [action] : []),
            );
            if (choice && err.version) {
                await installSdkWithProgress(err.version, err.api);
            }
            return undefined;
        }
        if (!opts.quiet) {
            vscode.window.showErrorMessage(`ArkTS check failed: ${errorMessage(err)}`);
        }
        oniroLogChannel.appendLine(`[check arkts] ${errorMessage(err)}`);
        return undefined;
    }

    if (!report.completed) {
        oniroLogChannel.appendLine(`[check arkts] The checker did not complete: ${report.error ?? 'unknown error'}`);
        if (!opts.quiet) {
            vscode.window.showErrorMessage(`The ArkTS checker did not complete: ${report.error ?? 'see the Oniro Log'}`);
        }
        return report;
    }

    if (diagnostics) {
        publishDiagnostics(diagnostics.arkts, opts.projectDir, report.diagnostics, opts.files);
    }
    const sdk = report.sdk ? ` against ${report.sdk.dir}` : '';
    oniroLogChannel.appendLine(`[check arkts] ${report.summary.files} file(s) checked${sdk} in ${(report.durationMs / 1000).toFixed(1)} s: ${summarize(report)}.`);
    for (const f of report.alsoModified) {
        oniroLogChannel.appendLine(`[check arkts] --fix also edited ${f}`);
    }
    return report;
}

async function checkCommand(fix: boolean): Promise<void> {
    let projectDir: string;
    try {
        projectDir = getProjectDir();
    } catch (err) {
        vscode.window.showErrorMessage(errorMessage(err));
        return;
    }
    if (fix) {
        const dirty = vscode.workspace.textDocuments.filter((d) => d.isDirty && d.fileName.endsWith('.ets'));
        if (dirty.length > 0) {
            const choice = await vscode.window.showWarningMessage(
                `Save ${dirty.length} modified ArkTS file(s) before fixing? The fixer edits files on disk.`,
                { modal: true },
                'Save All and Fix',
            );
            if (choice !== 'Save All and Fix') { return; }
            await vscode.workspace.saveAll(false);
        }
    }
    const report = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: fix ? 'Oniro: Fixing ArkTS problems…' : 'Oniro: Checking ArkTS…',
        cancellable: true,
    }, async (_p, token) => {
        const bridge = tokenToSignal(token);
        try {
            return await runArktsCheck({ projectDir, fix, signal: bridge.signal });
        } finally {
            bridge.dispose();
        }
    });
    if (!report?.completed) { return; }
    const text = `ArkTS check: ${summarize(report)}.`;
    if (report.summary.errors + report.summary.warnings > 0) {
        const actions = fix ? ['Show Problems'] : ['Show Problems', 'Fix Automatically'];
        const choice = await (report.ok ? vscode.window.showInformationMessage(text, ...actions) : vscode.window.showWarningMessage(text, ...actions));
        if (choice === 'Show Problems') {
            await vscode.commands.executeCommand('workbench.actions.view.problems');
        } else if (choice === 'Fix Automatically') {
            await checkCommand(true);
        }
    } else {
        vscode.window.showInformationMessage(text);
    }
}

export const checkArktsCommand = () => checkCommand(false);
export const fixArktsCommand = () => checkCommand(true);

/** Check a saved `.ets` file in the background when `oniro.checkArktsOnSave` is on. */
async function onSave(doc: vscode.TextDocument): Promise<void> {
    if (!doc.fileName.endsWith('.ets') || !vscode.workspace.getConfiguration('oniro').get<boolean>('checkArktsOnSave', false)) {
        return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const projectDir = folder?.uri.fsPath;
    if (!isOhosProject(projectDir)) { return; }
    const key = doc.uri.toString();
    onSaveRuns.get(key)?.abort();
    const controller = new AbortController();
    onSaveRuns.set(key, controller);
    const rel = path.relative(projectDir, doc.fileName);
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Checking ${path.basename(rel)}` }, () =>
        runArktsCheck({ projectDir, files: [rel], signal: controller.signal, quiet: true }),
    );
    if (onSaveRuns.get(key) === controller) { onSaveRuns.delete(key); }
}

export function initArktsCheck(context: vscode.ExtensionContext, diags: OniroDiagnostics): void {
    diagnostics = diags;
    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument((doc) => void onSave(doc)),
        { dispose: () => { for (const c of onSaveRuns.values()) { c.abort(); } } },
    );
}
