import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    type EmulatorStatus,
    attemptHdcConnection,
    getEmulatorStatus,
    isEmulatorInstalled,
    readLogTail,
    startEmulator,
    stopEmulator,
} from '@oniroproject/core';
import { tokenToSignal, vscodeConfigProvider, vscodeLogger } from './adapters';
import { OniroCommands } from './commandIds';
import type { DeviceManager } from './device';
import { oniroLogChannel } from './utils/logger';
import { errorMessage, isCancellation } from './utils/project';

let logFile: string | undefined;
let devices: DeviceManager | undefined;
let lastStatus: EmulatorStatus | undefined;

export function initEmulator(context: vscode.ExtensionContext, deviceManager: DeviceManager): void {
    fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
    logFile = path.join(context.globalStorageUri.fsPath, 'emulator.log');
    devices = deviceManager;
}

/** The emulator's QEMU log (written by the launcher), for error messages. */
export function emulatorLogFile(): string | undefined {
    return logFile;
}

function bootTimeoutSeconds(): number {
    const v = vscode.workspace.getConfiguration('oniro').get<number>('emulatorBootTimeout', 240);
    return Number.isFinite(v) && v > 0 ? v : 240;
}

/** The emulator status from the last {@link refreshEmulatorStatus}. */
export function cachedEmulatorStatus(): EmulatorStatus | undefined {
    return lastStatus;
}

/** Read whether the emulator is installed, running and connected. Never throws. */
export async function refreshEmulatorStatus(): Promise<EmulatorStatus | undefined> {
    try {
        lastStatus = await getEmulatorStatus(vscodeConfigProvider, { logger: vscodeLogger });
    } catch (err) {
        oniroLogChannel.appendLine(`[emulator] Could not read the emulator status: ${errorMessage(err)}`);
        lastStatus = undefined;
    }
    return lastStatus;
}

/** Offer to install the emulator when it is missing. Resolves true when it is installed. */
async function ensureEmulatorInstalled(): Promise<boolean> {
    if (isEmulatorInstalled(vscodeConfigProvider)) {
        return true;
    }
    const choice = await vscode.window.showWarningMessage(
        'The Oniro emulator is not installed.',
        'Open SDK Manager',
    );
    if (choice === 'Open SDK Manager') {
        await vscode.commands.executeCommand(OniroCommands.OPEN_SDK_MANAGER);
    }
    return false;
}

/**
 * Start the emulator (or reuse the running one) and wait until the guest reports
 * `bootevent.boot.completed`, so the next install does not race the boot. Throws on
 * failure; a cancelled wait throws a cancellation error.
 */
export async function startEmulatorAndWait(
    progress: vscode.Progress<{ message?: string }>,
    token?: vscode.CancellationToken,
): Promise<void> {
    if (!(await ensureEmulatorInstalled())) {
        throw new Error('The Oniro emulator is not installed.');
    }
    const bridge = tokenToSignal(token);
    const timeout = bootTimeoutSeconds();
    try {
        progress.report({ message: `Booting the emulator (up to ${timeout} s)…` });
        await startEmulator({
            config: vscodeConfigProvider,
            logger: vscodeLogger,
            logFile,
            waitReadySeconds: timeout,
            abortSignal: bridge.signal,
        });
    } catch (err) {
        if (!isCancellation(err) && logFile && fs.existsSync(logFile)) {
            const tail = readLogTail(logFile, 2000).trim();
            if (tail) {
                oniroLogChannel.appendLine(`[emulator] Last lines of ${logFile}:\n${tail}`);
            }
        }
        throw err;
    } finally {
        bridge.dispose();
    }
    await refreshEmulatorStatus();
    await devices?.refresh();
}

export async function startEmulatorCommand(): Promise<void> {
    try {
        await vscode.window.withProgress({
            title: 'Oniro Emulator',
            location: vscode.ProgressLocation.Notification,
            cancellable: true,
        }, (progress, token) => startEmulatorAndWait(progress, token));
        vscode.window.showInformationMessage('Oniro emulator is up and connected.');
    } catch (err) {
        if (isCancellation(err)) {
            vscode.window.showWarningMessage('Stopped waiting for the emulator; it keeps booting in the background.');
            return;
        }
        const choice = await vscode.window.showErrorMessage(`Failed to start the emulator: ${errorMessage(err)}`, 'Show Log');
        if (choice === 'Show Log') { oniroLogChannel.show(); }
    }
}

export async function stopEmulatorCommand(): Promise<void> {
    try {
        await stopEmulator(vscodeLogger);
        vscode.window.showInformationMessage('Oniro emulator stopped.');
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to stop the emulator: ${errorMessage(err)}`);
    }
    await refreshEmulatorStatus();
    await devices?.refresh();
}

export async function connectEmulatorCommand(): Promise<void> {
    try {
        const connected = await attemptHdcConnection(vscodeConfigProvider, undefined, vscodeLogger);
        if (!connected) {
            throw new Error('hdc could not reach the emulator at 127.0.0.1:55555. Is it running?');
        }
        vscode.window.showInformationMessage('Connected to the Oniro emulator.');
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to connect to the emulator: ${errorMessage(err)}`);
    }
    await refreshEmulatorStatus();
    await devices?.refresh();
}
