import * as vscode from 'vscode';

export class OniroDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        debugConfiguration: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): Promise<vscode.DebugConfiguration | undefined> {
        // Run the Oniro: Run All command before starting debug
        await vscode.commands.executeCommand('oniro-ide.runAll');
        // Optionally, you can show a message or do more checks here
        // Return the (possibly modified) debug configuration to continue launching
        return debugConfiguration;
    }
}
