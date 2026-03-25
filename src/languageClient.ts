import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { getOhosBaseSdkHome, detectProjectSdkVersion } from './utils/sdkUtils';

let client: LanguageClient;

export function startLanguageClient(context: vscode.ExtensionContext) {
    // Determine the path to the language server entry point
    // Using require.resolve to find the @arkts/language-server bin script
    let serverModule;
    try {
        const serverRoot = path.dirname(require.resolve('@arkts/language-server'));
        serverModule = path.join(serverRoot, '../bin/ets-language-server.js');
    } catch (e) {
        vscode.window.showErrorMessage('Failed to resolve @arkts/language-server.');
        return;
    }

    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { language: 'ets' },
            { language: 'json' },
            { pattern: '**/*.json5' }
        ],
        synchronize: {
            fileEvents: [
                vscode.workspace.createFileSystemWatcher('**/*.ets'),
                vscode.workspace.createFileSystemWatcher('**/*.json'),
                vscode.workspace.createFileSystemWatcher('**/*.json5')
            ]
        },
        initializationOptions: {
            ets: {
                // If API version is found, append it to the base SDK home (e.g. linux/20). Otherwise pass the base home or append '12' as fallback.
                sdkPath: (() => {
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (workspaceFolders && workspaceFolders.length > 0) {
                        const apiVersion = detectProjectSdkVersion(workspaceFolders[0].uri.fsPath);
                        if (apiVersion !== undefined) {
                            return path.join(getOhosBaseSdkHome(), String(apiVersion));
                        }
                    }
                    return getOhosBaseSdkHome();
                })()
            }
        }
    };

    client = new LanguageClient(
        'ets-language-server',
        'ETS Language Server',
        serverOptions,
        clientOptions
    );

    client.start();
}

export function stopLanguageClient(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
