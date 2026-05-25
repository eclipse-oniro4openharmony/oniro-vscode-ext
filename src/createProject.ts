import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
    type TemplateOption,
    createScaffold,
    getOhosBaseSdkHome,
    getSupportedSdksForUi,
    isValidBundleName,
    isValidProjectName,
    listTemplates,
} from '@oniroproject/core';
import { oniroLogChannel } from './utils/logger';
import { vscodeConfigProvider, vscodeLogger } from './adapters';

type CreateProjectArgs = {
    templateId: string;
    projectName: string;
    bundleName: string;
    location: string;
    sdkApi: number;
    moduleName: string;
};

type SdkOption = {
    version: string;
    api: number;
    installed: boolean;
};

function getTemplateRoot(context: vscode.ExtensionContext): string {
    return path.join(context.extensionPath, 'template');
}

function getTemplateOptions(context: vscode.ExtensionContext): TemplateOption[] {
    const templateRoot = getTemplateRoot(context);
    if (!fs.existsSync(templateRoot)) {
        return [];
    }
    return listTemplates(templateRoot);
}

function getSdkOptions(): SdkOption[] {
    return getSupportedSdksForUi(vscodeConfigProvider).map((sdk) => ({
        version: sdk.version,
        api: Number(sdk.api),
        installed: sdk.installed,
    }));
}

/**
 * Ensures the selected SDK API directory exists, or guides the user to install it.
 * Returns false if the user cancels or chooses to open the SDK Manager.
 */
async function ensureSelectedSdkInstalled(selectedApi: number): Promise<boolean> {
    const sdkDir = path.join(getOhosBaseSdkHome(vscodeConfigProvider), String(selectedApi));
    if (fs.existsSync(sdkDir)) {
        return true;
    }

    const choice = await vscode.window.showWarningMessage(
        `Selected SDK API ${selectedApi} is not installed under: ${sdkDir}.\n\nYou can install it via Oniro SDK Manager.`,
        { modal: true },
        'Open SDK Manager',
        'Create Anyway',
    );

    if (choice === 'Open SDK Manager') {
        await vscode.commands.executeCommand('oniro-ide.openSdkManager');
        return false;
    }
    if (choice === 'Create Anyway') {
        return true;
    }
    return false;
}

function getWebviewHtml(context: vscode.ExtensionContext): string {
    const htmlPath = path.join(context.extensionPath, 'out', 'createProjectWebview.html');
    try {
        return fs.readFileSync(htmlPath, 'utf8');
    } catch (err) {
        return `<html><body><h2>Failed to load Create Project UI</h2><pre>${String(err)}</pre></body></html>`;
    }
}

export function registerCreateProjectCommand(context: vscode.ExtensionContext): void {
    const disposable = vscode.commands.registerCommand('oniro-ide.createProject', async () => {
        const panel = vscode.window.createWebviewPanel(
            'oniroCreateProject',
            'Oniro: Create Project',
            vscode.ViewColumn.One,
            { enableScripts: true },
        );

        panel.webview.html = getWebviewHtml(context);

        const templateOptions = getTemplateOptions(context);
        const sdkOptions = getSdkOptions();
        const supportedApis = new Set(sdkOptions.map(s => s.api));
        // Prefer the latest installed SDK; otherwise fall back to the latest available.
        const defaultSdkApi = sdkOptions.find(s => s.installed)?.api ?? sdkOptions[0]?.api ?? 12;
        const defaultTemplateId = templateOptions.find(t => t.id === 'EmptyAbility')?.id ?? templateOptions[0]?.id ?? 'EmptyAbility';
        const defaultTemplateModuleName = templateOptions.find(t => t.id === defaultTemplateId)?.defaultModuleName ?? 'entry';

        const defaults: CreateProjectArgs = {
            templateId: defaultTemplateId,
            projectName: 'MyApplication',
            bundleName: 'com.example.myapplication',
            location: os.homedir(),
            sdkApi: defaultSdkApi,
            moduleName: defaultTemplateModuleName,
        };

        const readyListener = panel.webview.onDidReceiveMessage((message) => {
            if (message?.command === 'webviewReady') {
                panel.webview.postMessage({ command: 'init', defaults, sdkOptions, templateOptions });
                readyListener.dispose();
            }
        });

        panel.webview.onDidReceiveMessage(async (message) => {
            try {
                if (message?.command === 'pickLocation') {
                    const picked = await vscode.window.showOpenDialog({
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: false,
                        defaultUri: vscode.Uri.file(os.homedir()),
                        openLabel: 'Select Location',
                    });
                    if (picked && picked[0]) {
                        panel.webview.postMessage({ command: 'locationPicked', location: picked[0].fsPath });
                    }
                    return;
                }

                if (message?.command === 'createProject') {
                    panel.webview.postMessage({ command: 'clearError' });

                    const args: CreateProjectArgs = {
                        templateId: String(message.templateId ?? '').trim(),
                        projectName: String(message.projectName ?? '').trim(),
                        bundleName: String(message.bundleName ?? '').trim(),
                        location: String(message.location ?? '').trim(),
                        sdkApi: Number(message.sdkApi),
                        moduleName: String(message.moduleName ?? 'entry').trim() || 'entry',
                    };

                    if (!args.templateId) {
                        panel.webview.postMessage({ command: 'setError', message: 'Please select a template.' });
                        return;
                    }
                    if (!isValidProjectName(args.projectName)) {
                        panel.webview.postMessage({ command: 'setError', message: 'Invalid project name. Use letters/numbers/._- and no slashes.' });
                        return;
                    }
                    if (!isValidBundleName(args.bundleName)) {
                        panel.webview.postMessage({ command: 'setError', message: 'Invalid bundle name. Example: com.example.myapplication' });
                        return;
                    }
                    if (!args.location) {
                        panel.webview.postMessage({ command: 'setError', message: 'Please select a location.' });
                        return;
                    }
                    if (!args.moduleName || args.moduleName.includes('/') || args.moduleName.includes('\\')) {
                        panel.webview.postMessage({ command: 'setError', message: 'Invalid module name.' });
                        return;
                    }
                    if (!supportedApis.has(args.sdkApi)) {
                        panel.webview.postMessage({ command: 'setError', message: 'Unsupported SDK selection.' });
                        return;
                    }

                    if (!(await ensureSelectedSdkInstalled(args.sdkApi))) {
                        return;
                    }

                    // Warn before overwriting an existing folder.
                    const projectDir = path.join(args.location, args.projectName);
                    if (fs.existsSync(projectDir)) {
                        const answer = await vscode.window.showWarningMessage(
                            `Folder already exists: ${projectDir}. Overwrite its contents?`,
                            { modal: true },
                            'Overwrite',
                        );
                        if (answer !== 'Overwrite') {
                            return;
                        }
                    }

                    oniroLogChannel.appendLine(`[CreateProject] Creating project '${args.projectName}' at '${args.location}'`);
                    const { projectDir: createdProjectDir } = await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: 'Oniro: Creating project…',
                            cancellable: false,
                        },
                        () => createScaffold({
                            config: vscodeConfigProvider,
                            templateId: args.templateId,
                            projectName: args.projectName,
                            bundleName: args.bundleName,
                            location: args.location,
                            sdkApi: args.sdkApi,
                            moduleName: args.moduleName,
                            templateRoot: getTemplateRoot(context),
                            overwrite: true,
                            logger: vscodeLogger,
                        }),
                    );

                    panel.dispose();
                    await vscode.commands.executeCommand(
                        'vscode.openFolder',
                        vscode.Uri.file(createdProjectDir),
                        { forceReuseWindow: true },
                    );
                }
            } catch (err) {
                const messageText = err instanceof Error ? err.message : String(err);
                oniroLogChannel.appendLine(`[CreateProject] ERROR: ${messageText}`);
                panel.webview.postMessage({ command: 'setError', message: messageText });
            }
        });
    });

    context.subscriptions.push(disposable);
}
