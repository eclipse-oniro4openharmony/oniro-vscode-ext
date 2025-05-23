import * as vscode from 'vscode';
import { OniroCommands } from './OniroTreeDataProvider';
import * as fs from 'fs';
import * as path from 'path';
import {
    SdkInfo,
    ALL_SDKS,
    getInstalledSdks,
    getCmdToolsStatus,
    downloadAndInstallSdk,
    installCmdTools,
    removeCmdTools,
    removeSdk,
    isEmulatorInstalled,
    installEmulator,
    removeEmulator
} from './utils/sdkUtils';

interface SdkManagerState {
    sdks: SdkInfo[];
    cmdTools: { installed: boolean; status: string };
    emulator: { installed: boolean; status: string };
}

interface MessageHandler {
    [key: string]: (message: any, context: SdkManagerContext) => Promise<void>;
}

interface SdkManagerContext {
    panel: vscode.WebviewPanel;
    currentAbortController?: AbortController;
    updateState: () => void;
}

export function getAvailableSdks(): SdkInfo[] {
    const installedSdks = getInstalledSdks();
    return ALL_SDKS.map(sdk => ({ ...sdk, installed: installedSdks.includes(sdk.version) }));
}

function getCurrentState(): SdkManagerState {
    return {
        sdks: getAvailableSdks(),
        cmdTools: getCmdToolsStatus(),
        emulator: {
            installed: isEmulatorInstalled(),
            status: isEmulatorInstalled() ? 'Installed' : 'Not installed'
        }
    };
}

export function getSdkManagerHtml(context: vscode.ExtensionContext): string {
    const htmlPath = path.join(context.extensionPath, 'src', 'sdkManagerWebview.html');
    return fs.readFileSync(htmlPath, 'utf8');
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
                cancellable: true
            }, async (progress, token) => {
                token.onCancellationRequested(() => {
                    context.currentAbortController?.abort();
                });
                await downloadAndInstallSdk(message.version, message.api, progress, context.currentAbortController?.signal);
            });
            
            context.updateState();
            vscode.window.showInformationMessage(`SDK ${message.version} (API ${message.api}) installed.`);
        } catch (err: any) {
            if (err?.message === 'Download cancelled') {
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
            const removed = removeSdk(api);
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
        if (context.currentAbortController) context.currentAbortController.abort();
        context.currentAbortController = new AbortController();
        
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Installing OpenHarmony Command Line Tools',
                cancellable: true
            }, async (progress, token) => {
                token.onCancellationRequested(() => {
                    context.currentAbortController?.abort();
                });
                await installCmdTools(progress, context.currentAbortController?.signal);
            });
            
            context.updateState();
            vscode.window.showInformationMessage('Command line tools installed.');
        } catch (err: any) {
            if (err?.message === 'Download cancelled') {
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
            removeCmdTools();
            context.updateState();
            vscode.window.showInformationMessage('Command line tools removed.');
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to remove command line tools: ${err.message}`);
        }
    },

    async installEmulator(message, context) {
        if (context.currentAbortController) context.currentAbortController.abort();
        context.currentAbortController = new AbortController();
        
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Installing Oniro Emulator',
                cancellable: true
            }, async (progress, token) => {
                token.onCancellationRequested(() => {
                    context.currentAbortController?.abort();
                });
                await installEmulator(progress, context.currentAbortController?.signal);
            });
            
            context.updateState();
            vscode.window.showInformationMessage('Oniro Emulator installed.');
        } catch (err: any) {
            if (err?.message === 'Download cancelled') {
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
            removeEmulator();
            context.updateState();
            vscode.window.showInformationMessage('Oniro Emulator removed.');
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to remove emulator: ${err.message}`);
        }
    }
};

export function registerSdkManagerCommand(context: vscode.ExtensionContext) {
    const openSdkManagerDisposable = vscode.commands.registerCommand(OniroCommands.OPEN_SDK_MANAGER, () => {
        const panel = vscode.window.createWebviewPanel(
            'oniroSdkManager',
            'Oniro SDK Manager',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        let currentAbortController: AbortController | undefined;

        const updateState = () => {
            const state = getCurrentState();
            panel.webview.postMessage({
                type: 'stateUpdate',
                state
            });
        };

        const managerContext: SdkManagerContext = {
            panel,
            get currentAbortController() { return currentAbortController; },
            set currentAbortController(value) { currentAbortController = value; },
            updateState
        };

        // Set initial HTML
        panel.webview.html = getSdkManagerHtml(context);

        // Send initial state
        updateState();

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
            []
        );
    });
    
    context.subscriptions.push(openSdkManagerDisposable);
}