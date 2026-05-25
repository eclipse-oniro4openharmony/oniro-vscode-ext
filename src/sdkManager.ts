import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    type SdkInfo,
    getOhosBaseSdkHome,
    getCmdToolsPath,
    getEmulatorDir,
    getCmdToolsStatus,
    getSupportedSdksForUi,
    getCmdToolsDownloadUrl,
    downloadAndInstallSdk,
    installCmdTools,
    removeCmdTools,
    removeSdk,
    isEmulatorInstalled,
    installEmulator,
    removeEmulator,
} from '@oniroproject/core';
import { OniroCommands } from './OniroTreeDataProvider';
import { vscodeConfigProvider, vscodeLogger, tokenToSignal } from './adapters';

type SdkInfoWithPath = SdkInfo & { installPath?: string };

interface SdkManagerState {
    sdks: SdkInfoWithPath[];
    cmdTools: { installed: boolean; status: string; installPath: string };
    emulator: { installed: boolean; status: string; installPath: string };
}

interface MessageHandler {
    [key: string]: (message: any, context: SdkManagerContext) => Promise<void>;
}

interface SdkManagerContext {
    panel: vscode.WebviewPanel;
    currentAbortController?: AbortController;
    updateState: () => void;
}

export function getAvailableSdks(): SdkInfoWithPath[] {
    const base = getOhosBaseSdkHome(vscodeConfigProvider);
    return getSupportedSdksForUi(vscodeConfigProvider).map((sdk) => ({
        ...sdk,
        installPath: sdk.installed ? path.join(base, String(sdk.api)) : undefined,
    }));
}

function getCurrentState(): SdkManagerState {
    const cmdToolsStatus = getCmdToolsStatus(vscodeConfigProvider);
    return {
        sdks: getAvailableSdks(),
        cmdTools: {
            ...cmdToolsStatus,
            installPath: getCmdToolsPath(vscodeConfigProvider),
        },
        emulator: {
            installed: isEmulatorInstalled(vscodeConfigProvider),
            status: isEmulatorInstalled(vscodeConfigProvider) ? 'Installed' : 'Not installed',
            installPath: getEmulatorDir(vscodeConfigProvider),
        },
    };
}

export function getSdkManagerHtml(context: vscode.ExtensionContext): string {
    const htmlPath = path.join(context.extensionPath, 'out', 'sdkManagerWebview.html');
    return fs.readFileSync(htmlPath, 'utf8');
}

/**
 * Ask the user to pick a local cmd-tools ZIP when no download URL is configured for the OS.
 * Returns the absolute path or undefined if the user cancelled.
 */
async function promptForCmdToolsZip(): Promise<string | undefined> {
    vscode.window.showInformationMessage(
        'No download URL is configured for command line tools on this OS. Please download the ZIP manually and select it for installation.',
    );
    const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: 'Select ZIP file',
        filters: { 'ZIP files': ['zip'] },
    });
    return uris && uris.length > 0 ? uris[0].fsPath : undefined;
}

const messageHandlers: MessageHandler = {
    async downloadSdk(message, context) {
        if (context.currentAbortController) {
            context.currentAbortController.abort();
        }
        context.currentAbortController = new AbortController();

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Downloading and installing SDK ${message.version} (API ${message.api})`,
                cancellable: true,
            }, async (progress, token) => {
                const bridge = tokenToSignal(token);
                token.onCancellationRequested(() => context.currentAbortController?.abort());
                try {
                    await downloadAndInstallSdk({
                        config: vscodeConfigProvider,
                        version: message.version,
                        api: message.api,
                        progress,
                        abortSignal: context.currentAbortController?.signal ?? bridge.signal,
                        logger: vscodeLogger,
                    });
                } finally {
                    bridge.dispose();
                }
            });

            context.updateState();
            const sdkInstallPath = path.join(getOhosBaseSdkHome(vscodeConfigProvider), String(message.api));
            vscode.window.showInformationMessage(`SDK ${message.version} (API ${message.api}) installed to: ${sdkInstallPath}`);
        } catch (err: any) {
            if (err?.message === 'Download cancelled' || err?.name === 'CancelledError') {
                vscode.window.showWarningMessage('SDK download cancelled.');
            } else {
                vscode.window.showErrorMessage(`Failed to install SDK: ${err.message}`);
            }
        } finally {
            context.currentAbortController = undefined;
        }
    },

    async removeSdk(message, context) {
        try {
            const { version, api } = message;
            const removed = removeSdk(vscodeConfigProvider, api);
            context.updateState();

            if (removed) {
                vscode.window.showInformationMessage(`SDK ${version} (API ${api}) removed.`);
            } else {
                vscode.window.showWarningMessage(`SDK ${version} (API ${api}) not found.`);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to remove SDK: ${err.message}`);
        }
    },

    async installCmdTools(message, context) {
        if (context.currentAbortController) { context.currentAbortController.abort(); }
        context.currentAbortController = new AbortController();

        // Resolve a download URL up front; if the platform has none, prompt the user for a local ZIP.
        let localZipPath: string | undefined;
        try {
            getCmdToolsDownloadUrl(vscodeConfigProvider);
        } catch {
            localZipPath = await promptForCmdToolsZip();
            if (!localZipPath) {
                context.currentAbortController = undefined;
                return;
            }
        }

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Installing OpenHarmony Command Line Tools',
                cancellable: true,
            }, async (progress, token) => {
                const bridge = tokenToSignal(token);
                token.onCancellationRequested(() => context.currentAbortController?.abort());
                try {
                    await installCmdTools({
                        config: vscodeConfigProvider,
                        progress,
                        abortSignal: context.currentAbortController?.signal ?? bridge.signal,
                        logger: vscodeLogger,
                        localZipPath,
                    });
                } finally {
                    bridge.dispose();
                }
            });

            context.updateState();
            vscode.window.showInformationMessage(`Command line tools installed to: ${getCmdToolsPath(vscodeConfigProvider)}`);
        } catch (err: any) {
            if (err?.message === 'Download cancelled' || err?.name === 'CancelledError') {
                vscode.window.showWarningMessage('Command line tools installation cancelled.');
            } else {
                vscode.window.showErrorMessage(`Failed to install command line tools: ${err.message}`);
            }
        } finally {
            context.currentAbortController = undefined;
        }
    },

    async removeCmdTools(message, context) {
        try {
            removeCmdTools(vscodeConfigProvider);
            context.updateState();
            vscode.window.showInformationMessage('Command line tools removed.');
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to remove command line tools: ${err.message}`);
        }
    },

    async installEmulator(message, context) {
        if (context.currentAbortController) { context.currentAbortController.abort(); }
        context.currentAbortController = new AbortController();

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Installing Oniro Emulator',
                cancellable: true,
            }, async (progress, token) => {
                const bridge = tokenToSignal(token);
                token.onCancellationRequested(() => context.currentAbortController?.abort());
                try {
                    await installEmulator({
                        config: vscodeConfigProvider,
                        progress,
                        abortSignal: context.currentAbortController?.signal ?? bridge.signal,
                        logger: vscodeLogger,
                    });
                } finally {
                    bridge.dispose();
                }
            });

            context.updateState();
            vscode.window.showInformationMessage(`Oniro Emulator installed to: ${getEmulatorDir(vscodeConfigProvider)}`);
        } catch (err: any) {
            if (err?.message === 'Download cancelled' || err?.name === 'CancelledError') {
                vscode.window.showWarningMessage('Emulator installation cancelled.');
            } else {
                vscode.window.showErrorMessage(`Failed to install emulator: ${err.message}`);
            }
        } finally {
            context.currentAbortController = undefined;
        }
    },

    async removeEmulator(message, context) {
        try {
            removeEmulator(vscodeConfigProvider);
            context.updateState();
            vscode.window.showInformationMessage('Oniro Emulator removed.');
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to remove emulator: ${err.message}`);
        }
    },
};

export function registerSdkManagerCommand(context: vscode.ExtensionContext) {
    const openSdkManagerDisposable = vscode.commands.registerCommand(OniroCommands.OPEN_SDK_MANAGER, () => {
        const panel = vscode.window.createWebviewPanel(
            'oniroSdkManager',
            'Oniro SDK Manager',
            vscode.ViewColumn.One,
            { enableScripts: true },
        );

        let currentAbortController: AbortController | undefined;

        const updateState = () => {
            const state = getCurrentState();
            panel.webview.postMessage({
                type: 'stateUpdate',
                state,
            });
        };

        const managerContext: SdkManagerContext = {
            panel,
            get currentAbortController() { return currentAbortController; },
            set currentAbortController(value) { currentAbortController = value; },
            updateState,
        };

        panel.webview.html = getSdkManagerHtml(context);

        updateState();

        panel.onDidChangeViewState(() => {
            if (panel.visible) {
                updateState();
            }
        });

        panel.webview.onDidReceiveMessage(
            async message => {
                const handler = messageHandlers[message.command];
                if (handler) {
                    await handler(message, managerContext);
                } else {
                    console.warn(`Unknown command: ${message.command}`);
                }
            },
            undefined,
            [],
        );
    });

    context.subscriptions.push(openSdkManagerDisposable);
}
