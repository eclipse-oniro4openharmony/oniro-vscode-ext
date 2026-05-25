import * as vscode from 'vscode';
import * as path from 'path';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { detectProjectSdkVersion, getOhosBaseSdkHome } from '@oniroproject/core';
import { vscodeConfigProvider, vscodeLogger } from './adapters';

let client: LanguageClient;

export function startLanguageClient(context: vscode.ExtensionContext) {
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
            options: debugOptions,
        },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { language: 'ets' },
            { language: 'json' },
            { pattern: '**/*.json5' },
        ],
        synchronize: {
            fileEvents: [
                vscode.workspace.createFileSystemWatcher('**/*.ets'),
                vscode.workspace.createFileSystemWatcher('**/*.json'),
                vscode.workspace.createFileSystemWatcher('**/*.json5'),
            ],
        },
        initializationOptions: {
            ets: {
                sdkPath: (() => {
                    const baseSdkHome = getOhosBaseSdkHome(vscodeConfigProvider);
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (workspaceFolders && workspaceFolders.length > 0) {
                        const apiVersion = detectProjectSdkVersion(workspaceFolders[0].uri.fsPath, vscodeLogger);
                        if (apiVersion !== undefined) {
                            return path.join(baseSdkHome, String(apiVersion));
                        }
                    }
                    return baseSdkHome;
                })(),
            },
        },
    };

    client = new LanguageClient(
        'ets-language-server',
        'ETS Language Server',
        serverOptions,
        clientOptions,
    );

    client.start();
}

export function stopLanguageClient(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}
