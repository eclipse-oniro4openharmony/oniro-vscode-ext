import * as vscode from 'vscode';
import { OniroCommands } from '../commandIds';

/**
 * `"type": "oniro-debug"` launch configurations run Oniro: Run All (build, install,
 * launch, follow the log). There is no ArkTS debug adapter yet, so the launch itself
 * is cancelled once Run All has finished instead of starting a session that would
 * fail.
 */
export class OniroDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    async resolveDebugConfiguration(): Promise<vscode.DebugConfiguration | undefined> {
        await vscode.commands.executeCommand(OniroCommands.RUN_ALL);
        return undefined;
    }
}
