import * as vscode from 'vscode';
import * as path from 'path';
import { installApp, launchApp } from '../utils/hdcManager';

export class OniroDebugProvider implements vscode.DebugConfigurationProvider {
    async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        debugConfig: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration | undefined> {
        try {
            await installApp();
            const bundleName = debugConfig.bundleName;
            if (!bundleName) {
                vscode.window.showErrorMessage('oniro-debug: bundleName missing in launch configuration');
                return undefined;
            }
            await launchApp(bundleName);
            vscode.window.showInformationMessage(`App ${bundleName} installed and launched.`);
        } catch (err) {
            vscode.window.showErrorMessage(`oniro-debug failed: ${err}`);
            return undefined;
        }
        return debugConfig;
    }
}