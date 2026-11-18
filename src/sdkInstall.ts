import * as path from 'path';
import * as vscode from 'vscode';
import { downloadAndInstallSdk, getOhosBaseSdkHome } from '@oniroproject/core';
import { tokenToSignal, vscodeConfigProvider, vscodeLogger } from './adapters';
import { errorMessage, isCancellation } from './utils/project';

/** API levels being installed, so two installs never extract into the same folder. */
const inFlight = new Set<string>();

/**
 * Download and install one OpenHarmony SDK release with a cancellable progress
 * notification. Resolves true when it was installed, false when cancelled or failed
 * (the user has been told either way).
 */
export async function installSdkWithProgress(version: string, api: string | number, externalSignal?: AbortSignal): Promise<boolean> {
    if (externalSignal?.aborted) {
        return false;
    }
    const key = String(api);
    if (inFlight.has(key)) {
        vscode.window.showInformationMessage(`OpenHarmony SDK API ${key} is already being installed.`);
        return false;
    }
    inFlight.add(key);
    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Installing OpenHarmony SDK ${version} (API ${api})`,
            cancellable: true,
        }, async (progress, token) => {
            const bridge = tokenToSignal(token);
            const onExternalAbort = () => bridge.abort();
            externalSignal?.addEventListener('abort', onExternalAbort);
            try {
                await downloadAndInstallSdk({
                    config: vscodeConfigProvider,
                    version,
                    api: String(api),
                    progress,
                    abortSignal: bridge.signal,
                    logger: vscodeLogger,
                });
            } finally {
                externalSignal?.removeEventListener('abort', onExternalAbort);
                bridge.dispose();
            }
        });
        const dir = path.join(getOhosBaseSdkHome(vscodeConfigProvider), String(api));
        vscode.window.showInformationMessage(`OpenHarmony SDK ${version} (API ${api}) installed to ${dir}.`);
        return true;
    } catch (err) {
        if (isCancellation(err)) {
            vscode.window.showWarningMessage('SDK installation cancelled.');
        } else {
            vscode.window.showErrorMessage(`Failed to install SDK ${version}: ${errorMessage(err)}`);
        }
        return false;
    } finally {
        inFlight.delete(key);
    }
}
