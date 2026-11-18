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
    describeCmdTools,
    describeReplacement,
    getHarmonyOsSdkListing,
    installCmdTools,
    installSdkFromArchive,
    installedEmulatorArch,
    OHOS_DAILY_BUILDS_URL,
    removeCmdTools,
    removeSdk,
    isEmulatorInstalled,
    installEmulator,
    removeEmulator,
} from '@oniroproject/core';
import { OniroCommands } from './commandIds';
import { installSdkWithProgress } from './sdkInstall';
import { oniroLogChannel } from './utils/logger';
import { vscodeConfigProvider, vscodeLogger, tokenToSignal } from './adapters';

type SdkInfoWithPath = SdkInfo & { installPath?: string };

interface SdkManagerState {
    sdks: SdkInfoWithPath[];
    cmdTools: { installed: boolean; status: string; installPath: string; description?: string; flavour?: string };
    emulator: { installed: boolean; status: string; installPath: string; arch?: string };
    harmonyOsSdk: { displayName?: string; api?: string; path: string; source?: string } | null;
    dailyBuildsUrl: string;
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
    const emulatorInstalled = isEmulatorInstalled(vscodeConfigProvider);
    let harmonyOsSdk: SdkManagerState['harmonyOsSdk'] = null;
    try {
        harmonyOsSdk = getHarmonyOsSdkListing(vscodeConfigProvider);
    } catch {
        harmonyOsSdk = null;
    }
    return {
        sdks: getAvailableSdks(),
        cmdTools: {
            installed: cmdToolsStatus.installed,
            status: cmdToolsStatus.status,
            installPath: getCmdToolsPath(vscodeConfigProvider),
            description: cmdToolsStatus.installed ? describeCmdTools(cmdToolsStatus) : undefined,
            flavour: cmdToolsStatus.flavour,
        },
        emulator: {
            installed: emulatorInstalled,
            status: emulatorInstalled ? 'Installed' : 'Not installed',
            installPath: getEmulatorDir(vscodeConfigProvider),
            arch: emulatorInstalled ? installedEmulatorArch(vscodeConfigProvider) : undefined,
        },
        harmonyOsSdk,
        dailyBuildsUrl: OHOS_DAILY_BUILDS_URL,
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
        await installSdkWithProgress(String(message.version), String(message.api));
        context.updateState();
    },

    async installSdkFromArchive(message, context) {
        const uris = await vscode.window.showOpenDialog({
            title: 'Install OpenHarmony SDK from archive',
            canSelectMany: false,
            openLabel: 'Install',
            filters: { 'SDK archives': ['gz', 'tgz'] },
        });
        const archivePath = uris?.[0]?.fsPath;
        if (!archivePath) { return; }
        const install = (force: boolean) => vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Installing SDK from ${path.basename(archivePath)}`,
            cancellable: true,
        }, async (progress, token) => {
            const bridge = tokenToSignal(token);
            try {
                return await installSdkFromArchive({ config: vscodeConfigProvider, archivePath, force, progress, abortSignal: bridge.signal, logger: vscodeLogger });
            } finally {
                bridge.dispose();
            }
        });
        try {
            let installed;
            try {
                installed = await install(false);
            } catch (err: any) {
                if (!/--force|already installed/i.test(String(err?.message))) { throw err; }
                const choice = await vscode.window.showWarningMessage(`${String(err.message).replace(/;\s*pass --force[\s\S]*$/, '.')} Replace it?`, { modal: true }, 'Replace');
                if (choice !== 'Replace') { return; }
                installed = await install(true);
            }
            context.updateState();
            vscode.window.showInformationMessage(`SDK ${installed.version} (API ${installed.api}) installed to ${installed.dir}.`);
        } catch (err: any) {
            if (err?.name === 'CancelledError') {
                vscode.window.showWarningMessage('SDK installation cancelled.');
            } else {
                vscode.window.showErrorMessage(`Failed to install the SDK archive: ${err?.message ?? err}`);
            }
        }
    },

    async openUrl(message) {
        if (typeof message.url === 'string' && /^https:\/\//.test(message.url)) {
            await vscode.env.openExternal(vscode.Uri.parse(message.url));
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
                    const result = await installCmdTools({
                        config: vscodeConfigProvider,
                        progress,
                        abortSignal: context.currentAbortController?.signal ?? bridge.signal,
                        logger: vscodeLogger,
                        localZipPath,
                    });
                    if (result.previous) {
                        for (const line of describeReplacement(result.previous, result.installed)) {
                            oniroLogChannel.appendLine(`[cmdtools] ${line}`);
                        }
                    }
                    oniroLogChannel.appendLine(`[cmdtools] Installed ${describeCmdTools(result.installed)}.`);
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
                    oniroLogChannel.appendLine(`[SDK Manager] Unknown message: ${message.command}`);
                }
            },
            undefined,
            [],
        );
    });

    context.subscriptions.push(openSdkManagerDisposable);
}
