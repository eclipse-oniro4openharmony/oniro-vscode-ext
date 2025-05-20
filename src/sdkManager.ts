import * as vscode from 'vscode';
import { OniroCommands } from './OniroTreeDataProvider';

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

export function getSdkManagerHtml(sdkList: SdkInfo[]): string {
    return `
    <!DOCTYPE html>
    <html lang=\"en\">
    <head>
        <meta charset=\"UTF-8\">
        <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
        <title>Oniro SDK Manager</title>
        <style>
            body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; padding: 0; }
            h2 { margin: 16px; }
            .sdk-list { margin: 16px; }
            .sdk-item { display: flex; align-items: center; justify-content: space-between; padding: 12px; border-bottom: 1px solid var(--vscode-editorWidget-border); }
            .sdk-info { display: flex; flex-direction: column; }
            .sdk-version { font-weight: bold; }
            .sdk-api { font-size: 0.9em; color: var(--vscode-descriptionForeground); }
            .sdk-actions { display: flex; align-items: center; gap: 12px; }
            .sdk-actions button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 16px; border-radius: 4px; cursor: pointer; }
            .sdk-actions button:hover { background: var(--vscode-button-hoverBackground); }
            .sdk-checkbox { width: 18px; height: 18px; }
        </style>
    </head>
    <body>
        <h2>Oniro SDK Manager</h2>
        <div class=\"sdk-list\">
            ${sdkList.map(sdk => `
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
            `).join('')}
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            function downloadSdk(version, api) {
                vscode.postMessage({ command: 'downloadSdk', version, api });
            }
        </script>
    </body>
    </html>
    `;
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
            panel.webview.html = getSdkManagerHtml(getAvailableSdks());
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
