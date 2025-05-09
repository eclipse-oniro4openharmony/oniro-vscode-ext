import * as vscode from 'vscode';
import * as path from 'path';
import { installApp, launchApp } from '../utils/hdcManager';

export class OniroDebugProvider implements vscode.DebugConfigurationProvider {
    async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        debugConfig: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration | undefined> {
        const appPkg: string | undefined = debugConfig.appPackage;
        if (!appPkg) {
            vscode.window.showErrorMessage('oniro-debug: appPackage missing in launch configuration');
            return undefined;
        }
        try {
            await installApp(appPkg);
            const bundleName = debugConfig.bundleName || path.basename(appPkg, '.hap');
            await launchApp(bundleName);
            vscode.window.showInformationMessage(`App ${bundleName} installed and launched.`);
        } catch (err) {
            vscode.window.showErrorMessage(`oniro-debug failed: ${err}`);
            return undefined;
        }
        return debugConfig;
    }
}