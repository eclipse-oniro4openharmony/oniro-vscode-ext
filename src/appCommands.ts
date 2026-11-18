import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    type CrashVerdict,
    type InstallAppResult,
    findRunningProcess,
    forceStop,
    getBundleName,
    installApp,
    latestCrash,
    launchApp,
    takeScreenshot,
    uninstallApp,
} from '@oniroproject/core';
import { vscodeConfigProvider, vscodeLogger } from './adapters';
import { OniroCommands } from './commandIds';
import type { DeviceManager } from './device';
import { codeBlock, escapeMd, fileLink, showMarkdownReport } from './report';
import { oniroLogChannel } from './utils/logger';
import { errorMessage, getProjectDir, resolveProjectFile } from './utils/project';

let devices: DeviceManager | undefined;
let storageDir = '';

export function initAppCommands(context: vscode.ExtensionContext, deviceManager: DeviceManager): void {
    devices = deviceManager;
    storageDir = context.globalStorageUri.fsPath;
}

function serial(): string | undefined {
    return devices?.effectiveSerial;
}

/** The bundle manager refuses `install -r` over an app signed with other material. */
const SIGN_INFO_INCONSISTENT = /9568332|sign.*info.*inconsistent/i;

/**
 * Install the project's HAP on the target device. When the installed copy was signed
 * with other material (9568332), offer to uninstall it first, which wipes the app's
 * data, instead of failing.
 */
export async function installProjectApp(projectDir: string, hapPath?: string): Promise<InstallAppResult | undefined> {
    try {
        return await installApp({ config: vscodeConfigProvider, projectDir, hapPath, deviceSerial: serial(), logger: vscodeLogger });
    } catch (err) {
        if (!SIGN_INFO_INCONSISTENT.test(errorMessage(err))) {
            throw err;
        }
        const bundle = getBundleName(projectDir);
        const choice = await vscode.window.showWarningMessage(
            `${bundle} is already installed with a different signature. Uninstall it and install again? The app's data on the device is lost.`,
            { modal: true },
            'Uninstall and Install',
        );
        if (choice !== 'Uninstall and Install') {
            return undefined;
        }
        oniroLogChannel.appendLine(`[install] Signature mismatch: uninstalling ${bundle} and installing fresh.`);
        await uninstallApp({ config: vscodeConfigProvider, bundle, deviceSerial: serial(), logger: vscodeLogger });
        return installApp({ config: vscodeConfigProvider, projectDir, hapPath, deviceSerial: serial(), logger: vscodeLogger });
    }
}

export async function installCommand(): Promise<void> {
    try {
        const projectDir = getProjectDir();
        const result = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Oniro: Installing app…',
        }, () => installProjectApp(projectDir));
        if (result) {
            vscode.window.showInformationMessage(`Installed ${result.bundleName || path.basename(result.hapPath)}.`);
        }
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to install the app: ${errorMessage(err)}`);
    }
}

/** Launch the project's app; resolves to its PID when it could be found. */
export async function launchProjectApp(projectDir: string, token?: vscode.CancellationToken): Promise<string | undefined> {
    await launchApp({ config: vscodeConfigProvider, projectDir, deviceSerial: serial(), logger: vscodeLogger });
    // A cold start can take a few seconds to spawn the app's process: poll for it.
    const bundle = getBundleName(projectDir);
    const deadline = Date.now() + 15000;
    let lastError: unknown;
    while (!token?.isCancellationRequested && Date.now() < deadline) {
        try {
            const proc = await findRunningProcess({ config: vscodeConfigProvider, bundle, deviceSerial: serial(), timeoutMs: 3000, logger: vscodeLogger });
            if (proc) { return proc.pid; }
        } catch (err) {
            lastError = err;
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    if (!token?.isCancellationRequested) {
        oniroLogChannel.appendLine(`[launch] Could not find the process of ${bundle}${lastError ? `: ${errorMessage(lastError)}` : ''}.`);
    }
    return undefined;
}

/** Open the HiLog viewer on `pid`, if hilog-on-launch is enabled. */
export async function showHilogFor(pid: string | undefined): Promise<void> {
    if (!pid || !vscode.workspace.getConfiguration('oniro').get<boolean>('openHilogOnLaunch', true)) {
        return;
    }
    await vscode.commands.executeCommand(OniroCommands.SHOW_HILOG_VIEWER, { processId: pid, severity: 'INFO' });
}

export async function launchCommand(): Promise<void> {
    try {
        const projectDir = getProjectDir();
        const pid = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Oniro: Launching app…',
            cancellable: true,
        }, (_p, token) => launchProjectApp(projectDir, token));
        vscode.window.showInformationMessage(pid ? `App launched (PID ${pid}).` : 'App launched.');
        await showHilogFor(pid);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to launch the app: ${errorMessage(err)}`);
    }
}

export async function stopAppCommand(): Promise<void> {
    try {
        const bundle = getBundleName(getProjectDir());
        await forceStop({ config: vscodeConfigProvider, bundle, deviceSerial: serial(), logger: vscodeLogger });
        vscode.window.showInformationMessage(`Stopped ${bundle}.`);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to stop the app: ${errorMessage(err)}`);
    }
}

export async function uninstallCommand(): Promise<void> {
    try {
        const bundle = getBundleName(getProjectDir());
        const choice = await vscode.window.showWarningMessage(
            `Uninstall ${bundle} from the device? Its data is deleted.`,
            { modal: true },
            'Uninstall',
        );
        if (choice !== 'Uninstall') { return; }
        await uninstallApp({ config: vscodeConfigProvider, bundle, deviceSerial: serial(), logger: vscodeLogger });
        vscode.window.showInformationMessage(`Uninstalled ${bundle}.`);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to uninstall the app: ${errorMessage(err)}`);
    }
}

function timestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

/** Capture the device screen and open it in an editor tab. */
export async function screenshotCommand(): Promise<void> {
    try {
        const shot = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: 'Oniro: Capturing screenshot…',
        }, () => takeScreenshot({ config: vscodeConfigProvider, deviceSerial: serial(), logger: vscodeLogger }));
        const dir = path.join(storageDir, 'screenshots');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `screenshot_${timestamp()}.jpeg`);
        fs.writeFileSync(file, shot.pixels);
        const uri = vscode.Uri.file(file);
        await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
        const choice = await vscode.window.showInformationMessage(
            `Screenshot captured${shot.width ? ` (${shot.width}×${shot.height})` : ''}.`,
            'Save As…',
        );
        if (choice === 'Save As…') {
            const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
            const target = await vscode.window.showSaveDialog({
                defaultUri: folder ? vscode.Uri.joinPath(folder, path.basename(file)) : uri,
                filters: { 'JPEG image': ['jpeg', 'jpg'] },
            });
            if (target) {
                await vscode.workspace.fs.copy(uri, target, { overwrite: true });
            }
        }
    } catch (err) {
        vscode.window.showErrorMessage(`Screenshot failed: ${errorMessage(err)}`);
    }
}

/** Markdown for a crash verdict, with links into the project's sources. */
export function renderCrashReport(v: CrashVerdict, projectDir: string): string {
    const lines: string[] = [];
    const kind = { cpp_crash: 'Native crash', js_crash: 'JS crash', app_freeze: 'App freeze', sample_stack: 'Stack sample', unknown: 'Fault' }[v.kind] ?? v.kind;
    lines.push(`# ${kind}${v.bundle ? `: ${escapeMd(v.bundle)}` : ''}`);
    lines.push('');
    const facts: Array<[string, string | number | null | undefined]> = [
        ['When', v.time],
        ['Reason', v.reason],
        ['Event', v.subtype],
        ['Process', v.process ? `${v.process}${v.pid ? ` (pid ${v.pid})` : ''}` : null],
        ['Thread', v.threadName ? `${v.threadName}${v.tid ? ` (tid ${v.tid})` : ''}` : null],
        ['Confidence', `${v.confidence}, ${v.completeness}`],
    ];
    for (const [k, val] of facts) {
        if (val !== null && val !== undefined && val !== '') {
            lines.push(`- **${k}:** ${escapeMd(String(val))}`);
        }
    }
    if (v.file) {
        const abs = resolveProjectFile(projectDir, v.file);
        const link = fs.existsSync(abs) ? fileLink(abs, v.line, v.column, `${v.file}${v.line ? `:${v.line}` : ''}${v.column ? `:${v.column}` : ''}`) : escapeMd(v.file);
        lines.push(`- **Your code:** ${link}`);
    } else if (v.projectFrame) {
        lines.push(`- **Your code:** \`${v.projectFrame}\``);
    }
    if (v.topFrame) {
        lines.push(`- **Top frame:** \`${v.topFrame}\``);
    }
    if (v.jsError) {
        lines.push('', '## Error', '', `**${escapeMd(v.jsError.name)}:** ${escapeMd(v.jsError.message)}`, '', codeBlock(v.jsError.stack.join('\n')));
    }
    if (v.lastFatalMessage) {
        lines.push('', '## Last fatal message', '', codeBlock(v.lastFatalMessage));
    }
    if (v.deadlocks.length) {
        lines.push('', '## Deadlocks', '', ...v.deadlocks.map((d) => `- \`${d}\``));
    }
    if (v.binderChain.length) {
        lines.push('', '## Binder chain', '', codeBlock(v.binderChain.map((e) => JSON.stringify(e)).join('\n'), 'json'));
    }
    if (v.stack.length && !v.jsError) {
        lines.push('', '## Stack', '', codeBlock(v.stack.slice(0, 60).join('\n')));
    }
    if (v.notes.length) {
        lines.push('', '## Notes', '', ...v.notes.map((n) => `- ${escapeMd(n)}`));
    }
    lines.push('');
    if (v.rawPath) {
        lines.push(`Full fault log: ${fileLink(v.rawPath, undefined, undefined, v.name ?? path.basename(v.rawPath))}`);
    } else if (v.path) {
        lines.push(`Fault log on the device: \`${v.path}\``);
    }
    lines.push('');
    return lines.join('\n');
}

/** Fetch the app's newest fault log from the device and explain it. */
export async function showLastCrashCommand(): Promise<void> {
    try {
        const projectDir = getProjectDir();
        const bundle = getBundleName(projectDir);
        const saveDir = path.join(storageDir, 'faultlogs');
        fs.mkdirSync(saveDir, { recursive: true });
        const verdict = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Oniro: Looking for the latest crash of ${bundle}…`,
        }, () => latestCrash({ config: vscodeConfigProvider, bundle, deviceSerial: serial(), saveDir, timeoutMs: 30000, logger: vscodeLogger }));
        if (!verdict) {
            vscode.window.showInformationMessage(`No crash or freeze of ${bundle} is recorded on the device.`);
            return;
        }
        await showMarkdownReport('last-crash', renderCrashReport(verdict, projectDir));
        if (verdict.file) {
            const abs = resolveProjectFile(projectDir, verdict.file);
            if (fs.existsSync(abs)) {
                const line = Math.max(0, (verdict.line ?? 1) - 1);
                const col = Math.max(0, (verdict.column ?? 1) - 1);
                await vscode.window.showTextDocument(vscode.Uri.file(abs), {
                    selection: new vscode.Range(line, col, line, col),
                    viewColumn: vscode.ViewColumn.One,
                    preserveFocus: true,
                });
            }
        }
    } catch (err) {
        vscode.window.showErrorMessage(`Crash analysis failed: ${errorMessage(err)}`);
    }
}
