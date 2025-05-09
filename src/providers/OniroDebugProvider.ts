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
            await launchApp();
            vscode.window.showInformationMessage(`App installed and launched.`);
        } catch (err) {
            vscode.window.showErrorMessage(`oniro-debug failed: ${err}`);
            return undefined;
        }
        return debugConfig;
    }
}