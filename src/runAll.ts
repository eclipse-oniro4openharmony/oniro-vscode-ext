import * as vscode from 'vscode';
import { type BuildReport, emulatorHdcAddress, isUsableDevice, pickHap } from '@oniroproject/core';
import { OniroCommands } from './commandIds';
import { installProjectApp, launchProjectApp, showHilogFor } from './appCommands';
import { reportBuildFailure, runBuild, BuildError } from './build';
import type { DeviceManager } from './device';
import { startEmulatorAndWait } from './emulator';
import { oniroLogChannel } from './utils/logger';
import { errorMessage, getProjectDir, isCancellation } from './utils/project';

class StopRun extends Error {}

/** The HAP the build just produced: the single app module's, else the `entry` module's. */
function builtHap(report: BuildReport): string | undefined {
    if (vscode.workspace.getConfiguration('oniro').get<string>('hapPath')) { return undefined; }
    try {
        return pickHap(report.discoveredHaps)?.path;
    } catch {
        try {
            return pickHap(report.discoveredHaps, 'entry')?.path;
        } catch {
            return undefined;
        }
    }
}

/**
 * Make sure there is a device to install on: the selected one, the single connected
 * one, or else the Oniro emulator, started and booted.
 */
async function ensureTarget(
    devices: DeviceManager,
    progress: vscode.Progress<{ message?: string }>,
    token: vscode.CancellationToken,
): Promise<void> {
    progress.report({ message: 'Looking for a device…' });
    const known = await devices.refresh(false);
    const usable = known.filter(isUsableDevice);
    const selected = devices.effectiveSerial;
    const emulator = emulatorHdcAddress(undefined);

    if (selected) {
        if (usable.some((d) => d.serial === selected)) { return; }
        if (selected !== emulator) {
            throw new Error(`The selected device ${selected} is not connected. Connect it or pick another device.`);
        }
    } else if (usable.length === 1) {
        return;
    } else if (usable.length > 1) {
        const choice = await vscode.window.showWarningMessage(
            `${usable.length} devices are connected. Which one should Run All use?`,
            'Select Device',
        );
        if (choice) {
            await devices.pick();
        }
        if (!devices.effectiveSerial) { throw new StopRun(); }
        return;
    }
    await startEmulatorAndWait(progress, token);
}

export async function runAllCommand(devices: DeviceManager): Promise<void> {
    let projectDir: string;
    try {
        projectDir = getProjectDir();
    } catch (err) {
        vscode.window.showErrorMessage(errorMessage(err));
        return;
    }

    await vscode.window.withProgress({
        title: 'Oniro: Run',
        location: vscode.ProgressLocation.Notification,
        cancellable: true,
    }, async (progress, token) => {
        try {
            await ensureTarget(devices, progress, token);
            if (token.isCancellationRequested) { return; }

            progress.report({ message: 'Building…' });
            const report = await runBuild({ projectDir, token });
            if (!report || token.isCancellationRequested) { return; }

            progress.report({ message: 'Installing…' });
            const installed = await installProjectApp(projectDir, builtHap(report));
            if (!installed || token.isCancellationRequested) { return; }

            progress.report({ message: 'Launching…' });
            const pid = await launchProjectApp(projectDir, token);
            if (token.isCancellationRequested) { return; }
            await showHilogFor(pid);
            vscode.window.setStatusBarMessage(`$(rocket) ${installed.bundleName || 'App'} is running${pid ? ` (PID ${pid})` : ''}`, 8000);
        } catch (err) {
            if (err instanceof StopRun || isCancellation(err) || token.isCancellationRequested) {
                vscode.window.showWarningMessage('Oniro: Run cancelled.');
                return;
            }
            if (err instanceof BuildError) {
                await reportBuildFailure(err);
                return;
            }
            oniroLogChannel.appendLine(`[run] ${errorMessage(err)}`);
            const choice = await vscode.window.showErrorMessage(`Oniro: Run failed: ${errorMessage(err)}`, 'Show Log', 'Select Device');
            if (choice === 'Show Log') {
                oniroLogChannel.show();
            } else if (choice === 'Select Device') {
                await vscode.commands.executeCommand(OniroCommands.SELECT_DEVICE);
            }
        }
    });
}
