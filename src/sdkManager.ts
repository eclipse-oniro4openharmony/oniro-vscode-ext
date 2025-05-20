import * as vscode from 'vscode';
import { OniroCommands } from './OniroTreeDataProvider';
import * as fs from 'fs';
import * as path from 'path';

export interface SdkInfo {
    version: string;
    api: string;
    installed: boolean;
}

// For now, stub installed SDKs. In a real implementation, this would check the filesystem or config.
let installedSdks: string[] = ['4.0', '5.0.1']; // Example: 4.0 and 5.0.1 are installed

export function getAvailableSdks(): SdkInfo[] {
    const allSdks = [
        { version: '4.0', api: '10' },
        { version: '4.1', api: '11' },
        { version: '5.0.0', api: '12' },
        { version: '5.0.1', api: '13' },
        { version: '5.0.2', api: '14' },
        { version: '5.0.3', api: '15' },
        { version: '5.1.0', api: '18' }
    ];
    return allSdks.map(sdk => ({ ...sdk, installed: installedSdks.includes(sdk.version) }));
}

export function setSdkInstalled(version: string, installed: boolean) {
    if (installed) {
        if (!installedSdks.includes(version)) installedSdks.push(version);
    } else {
        installedSdks = installedSdks.filter(v => v !== version);
    }
}

export function getSdkManagerHtml(context: vscode.ExtensionContext, sdkList: SdkInfo[]): string {
    const htmlPath = path.join(context.extensionPath, 'src', 'sdkManagerWebview.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const sdkListHtml = sdkList.map(sdk => `
        <div class=\"sdk-item\">
            <div class=\"sdk-info\">
                <span class=\"sdk-version\">OpenHarmony ${sdk.version}</span>
                <span class=\"sdk-api\">API Level ${sdk.api}</span>
            </div>
            <div class=\"sdk-actions\">
                <input type=\"checkbox\" class=\"sdk-checkbox\" id=\"sdk-${sdk.version}\" ${sdk.installed ? 'checked' : ''} disabled />
                <button onclick=\"downloadSdk('${sdk.version}', '${sdk.api}')\" ${sdk.installed ? 'disabled' : ''}>Download & Install</button>
            </div>
        </div>
    `).join('');
    html = html.replace('<!-- SDK_LIST_PLACEHOLDER -->', sdkListHtml);
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
            panel.webview.html = getSdkManagerHtml(context, getAvailableSdks());
        }

        updateWebview();

        panel.webview.onDidReceiveMessage(
            message => {
                if (message.command === 'downloadSdk') {
                    vscode.window.showInformationMessage(`Stub: Downloading and installing SDK ${message.version} (API ${message.api})...`);
                    setTimeout(() => {
                        setSdkInstalled(message.version, true);
                        updateWebview();
                        vscode.window.showInformationMessage(`SDK ${message.version} (API ${message.api}) installed.`);
                    }, 1000);
                }
            },
            undefined,
            []
        );
    });
    context.subscriptions.push(openSdkManagerDisposable);
}
