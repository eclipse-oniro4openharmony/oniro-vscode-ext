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

export function getAvailableSdks(): SdkInfo[] {
    const installedSdks = getInstalledSdks();
    return ALL_SDKS.map(sdk => ({ ...sdk, installed: installedSdks.includes(sdk.version) }));
}

export function getSdkManagerHtml(context: vscode.ExtensionContext, sdkList: SdkInfo[], cmdToolsStatus?: { installed: boolean, status: string }): string {
    const htmlPath = path.join(context.extensionPath, 'src', 'sdkManagerWebview.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const sdkListHtml = sdkList.map(sdk => `
        <div class="sdk-item">
            <div class="sdk-info">
                <span class="sdk-version">OpenHarmony ${sdk.version}</span>
                <span class="sdk-api">API Level ${sdk.api}</span>
                <span class="sdk-status">${sdk.installed ? 'Installed' : 'Not installed'}</span>
            </div>
            <div class="sdk-actions">
                <input type="checkbox" class="sdk-checkbox" id="sdk-${sdk.version}" ${sdk.installed ? 'checked' : ''} disabled />
                ${
                    sdk.installed
                        ? `<button class="remove" onclick="removeSdk('${sdk.version}', '${sdk.api}')">Remove</button>`
                        : `<button onclick="downloadSdk('${sdk.version}', '${sdk.api}')">Download</button>`
                }
            </div>
        </div>
    `).join('');
    html = html.replace('<!-- SDK_LIST_PLACEHOLDER -->', sdkListHtml);
    // Inject command line tools status if available
    if (cmdToolsStatus) {
        html = html.replace(
            'id="cmd-tools-status">Checking...</span>',
            `id="cmd-tools-status">${cmdToolsStatus.status}</span>`
        );
        html = html.replace(
            'id="cmd-tools-install" style="display:none"',
            `id="cmd-tools-install" style="display:${cmdToolsStatus.installed ? 'none' : ''}"`
        );
        html = html.replace(
            'id="cmd-tools-remove" class="remove" style="display:none"',
            `id="cmd-tools-remove" class="remove" style="display:${cmdToolsStatus.installed ? '' : 'none'}"`
        );
    }
    return html;
}

export function registerSdkManagerCommand(context: vscode.ExtensionContext) {
    const openSdkManagerDisposable = vscode.commands.registerCommand(OniroCommands.OPEN_SDK_MANAGER, () => {
        const panel = vscode.window.createWebviewPanel(
            'oniroSdkManager',
            'Oniro SDK Manager',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        function updateWebview() {
            panel.webview.html = getSdkManagerHtml(
                context,
                getAvailableSdks(),
                getCmdToolsStatus()
            );
        }

        updateWebview();

        let currentAbortController: AbortController | undefined;

        panel.webview.onDidReceiveMessage(
            async message => {
                if (message.command === 'downloadSdk') {
                    if (currentAbortController) {
                        currentAbortController.abort();
                    }
                    currentAbortController = new AbortController();
                    try {
                        await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: `Downloading and installing SDK ${message.version} (API ${message.api})`,
                            cancellable: true
                        }, async (progress, token) => {
                            token.onCancellationRequested(() => {
                                currentAbortController?.abort();
                            });
                            await downloadAndInstallSdk(message.version, message.api, progress, currentAbortController?.signal);
                        });
                        updateWebview();
                        vscode.window.showInformationMessage(`SDK ${message.version} (API ${message.api}) installed.`);
                    } catch (err: any) {
                        if (err?.message === 'Download cancelled') {
                            vscode.window.showWarningMessage('SDK download cancelled.');
                        } else {
                            vscode.window.showErrorMessage(`Failed to install SDK: ${err.message}`);
                        }
                    } finally {
                        currentAbortController = undefined;
                    }
                } else if (message.command === 'removeSdk') {
                    try {
                        const { version, api } = message;
                        const removed = removeSdk(api);
                        updateWebview();
                        if (removed) {
                            vscode.window.showInformationMessage(`SDK ${version} (API ${api}) removed.`);
                        } else {
                            vscode.window.showWarningMessage(`SDK ${version} (API ${api}) not found.`);
                        }
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Failed to remove SDK: ${err.message}`);
                    }
                } else if (message.command === 'checkCmdTools') {
                    panel.webview.postMessage({
                        type: 'cmdToolsStatus',
                        ...getCmdToolsStatus()
                    });
                } else if (message.command === 'installCmdTools') {
                    if (currentAbortController) currentAbortController.abort();
                    currentAbortController = new AbortController();
                    try {
                        await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: 'Installing OpenHarmony Command Line Tools',
                            cancellable: true
                        }, async (progress, token) => {
                            token.onCancellationRequested(() => {
                                currentAbortController?.abort();
                            });
                            await installCmdTools(progress, currentAbortController?.signal);
                        });
                        updateWebview();
                        vscode.window.showInformationMessage('Command line tools installed.');
                    } catch (err: any) {
                        if (err?.message === 'Download cancelled') {
                            vscode.window.showWarningMessage('Command line tools installation cancelled.');
                        } else {
                            vscode.window.showErrorMessage(`Failed to install command line tools: ${err.message}`);
                        }
                    } finally {
                        currentAbortController = undefined;
                    }
                } else if (message.command === 'removeCmdTools') {
                    try {
                        removeCmdTools();
                        updateWebview();
                        vscode.window.showInformationMessage('Command line tools removed.');
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Failed to remove command line tools: ${err.message}`);
                    }
                } else if (message.command === 'checkEmulator') {
                    const installed = isEmulatorInstalled();
                    panel.webview.postMessage({
                        type: 'emulatorStatus',
                        installed,
                        status: installed ? 'Installed' : 'Not installed'
                    });
                } else if (message.command === 'installEmulator') {
                    if (currentAbortController) currentAbortController.abort();
                    currentAbortController = new AbortController();
                    try {
                        await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: 'Installing Oniro Emulator',
                            cancellable: true
                        }, async (progress, token) => {
                            token.onCancellationRequested(() => {
                                currentAbortController?.abort();
                            });
                            await installEmulator(progress, currentAbortController?.signal);
                        });
                        const installed = isEmulatorInstalled();
                        panel.webview.postMessage({
                            type: 'emulatorStatus',
                            installed,
                            status: installed ? 'Installed' : 'Not installed'
                        });
                        vscode.window.showInformationMessage('Oniro Emulator installed.');
                    } catch (err: any) {
                        panel.webview.postMessage({
                            type: 'emulatorStatus',
                            installed: false,
                            status: 'Not installed'
                        });
                        if (err?.message === 'Download cancelled') {
                            vscode.window.showWarningMessage('Emulator installation cancelled.');
                        } else {
                            vscode.window.showErrorMessage(`Failed to install emulator: ${err.message}`);
                        }
                    } finally {
                        currentAbortController = undefined;
                    }
                } else if (message.command === 'removeEmulator') {
                    try {
                        removeEmulator();
                        const installed = isEmulatorInstalled();
                        panel.webview.postMessage({
                            type: 'emulatorStatus',
                            installed,
                            status: installed ? 'Installed' : 'Not installed'
                        });
                        vscode.window.showInformationMessage('Oniro Emulator removed.');
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Failed to remove emulator: ${err.message}`);
                    }
                }
            },
            undefined,
            []
        );
    });
    context.subscriptions.push(openSdkManagerDisposable);
}
