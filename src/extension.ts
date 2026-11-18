import * as vscode from 'vscode';
import { VERSION } from '@oniroproject/core';
import { OniroCommands } from './commandIds';
import { oniroLogChannel } from './utils/logger';
import { getProjectDir, errorMessage, tryGetWorkspaceRoot, isOhosProject } from './utils/project';
import { buildWithProgress, initBuild } from './build';
import { DeviceManager } from './device';
import { OniroDiagnostics } from './diagnostics';
import { initReports } from './report';
import {
    connectEmulatorCommand,
    initEmulator,
    refreshEmulatorStatus,
    startEmulatorCommand,
    stopEmulatorCommand,
} from './emulator';
import {
    initAppCommands,
    installCommand,
    launchCommand,
    screenshotCommand,
    showLastCrashCommand,
    stopAppCommand,
    uninstallCommand,
} from './appCommands';
import { checkArktsCommand, fixArktsCommand, initArktsCheck } from './arktsCheck';
import { initDoctor, onDidChangeDoctorReport, runDoctorCheck } from './doctor';
import { harmonyOsLogin, harmonyOsLogout, signCommand, signHapCommand, verifyHapCommand } from './signing';
import { searchApiCommand, searchDocsCommand, syncDocsCommand } from './knowledge';
import { runAllCommand } from './runAll';
import { OhosTestController } from './testing';
import { registerHilogViewerCommand } from './hilogViewer';
import { OniroTreeDataProvider } from './OniroTreeDataProvider';
import { registerSdkManagerCommand } from './sdkManager';
import { OniroDebugConfigurationProvider } from './providers/OniroDebugConfigurationProvider';
import { OniroTaskProvider } from './providers/oniroTaskProvider';
import { registerCreateProjectCommand } from './createProject';
import { registerBuildConfigCommand } from './buildConfig';
import { startLanguageClient, stopLanguageClient } from './languageClient';

/** How often the sidebar re-reads device and emulator status while it is visible. */
const STATUS_POLL_MS = 20_000;

export function activate(context: vscode.ExtensionContext) {
    oniroLogChannel.appendLine(`[info] @oniroproject/core ${VERSION} loaded.`);
    startLanguageClient(context);

    initReports(context);
    const diagnostics = new OniroDiagnostics();
    const devices = new DeviceManager(context);
    initBuild(diagnostics);
    initEmulator(context, devices);
    initAppCommands(context, devices);
    initArktsCheck(context, diagnostics);
    initDoctor(context, devices);
    context.subscriptions.push(diagnostics, devices, oniroLogChannel);

    const isProject = () => isOhosProject(tryGetWorkspaceRoot());
    void vscode.commands.executeCommand('setContext', 'oniro.isProject', isProject());

    // Sidebar.
    const tree = new OniroTreeDataProvider(devices);
    const treeView = vscode.window.createTreeView('oniroMainView', { treeDataProvider: tree, showCollapseAll: true });
    const refreshStatus = async () => {
        await Promise.all([devices.refresh(), refreshEmulatorStatus()]);
        tree.refresh();
    };
    let poll: NodeJS.Timeout | undefined;
    const updatePolling = () => {
        if (treeView.visible && !poll) {
            void refreshStatus();
            poll = setInterval(() => void refreshStatus(), STATUS_POLL_MS);
        } else if (!treeView.visible && poll) {
            clearInterval(poll);
            poll = undefined;
        }
    };
    context.subscriptions.push(
        treeView,
        treeView.onDidChangeVisibility(updatePolling),
        devices.onDidChange(() => tree.refresh()),
        onDidChangeDoctorReport(() => tree.refresh()),
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            void vscode.commands.executeCommand('setContext', 'oniro.isProject', isProject());
            tree.refresh();
        }),
        { dispose: () => poll && clearInterval(poll) },
    );
    updatePolling();

    // Test Explorer.
    const tests = new OhosTestController(devices, diagnostics);
    context.subscriptions.push(tests);
    if (isProject()) {
        tests.discover();
    }

    const register = (id: string, fn: (...args: any[]) => unknown) =>
        context.subscriptions.push(vscode.commands.registerCommand(id, fn));

    register(OniroCommands.RUN_ALL, () => runAllCommand(devices));
    register(OniroCommands.QUICK_BUILD, async () => {
        try {
            await buildWithProgress({ projectDir: getProjectDir() });
        } catch (err) {
            vscode.window.showErrorMessage(errorMessage(err));
        }
    });
    register(OniroCommands.SIGN, signCommand);
    register(OniroCommands.SIGN_HAP, signHapCommand);
    register(OniroCommands.VERIFY_HAP, verifyHapCommand);
    register(OniroCommands.HARMONYOS_LOGIN, harmonyOsLogin);
    register(OniroCommands.HARMONYOS_LOGOUT, harmonyOsLogout);
    register(OniroCommands.CHECK_ARKTS, checkArktsCommand);
    register(OniroCommands.FIX_ARKTS, fixArktsCommand);
    register(OniroCommands.START_EMULATOR, startEmulatorCommand);
    register(OniroCommands.STOP_EMULATOR, stopEmulatorCommand);
    register(OniroCommands.CONNECT_EMULATOR, connectEmulatorCommand);
    register(OniroCommands.SELECT_DEVICE, () => devices.pick());
    register(OniroCommands.INSTALL_APP, installCommand);
    register(OniroCommands.LAUNCH_APP, launchCommand);
    register(OniroCommands.STOP_APP, stopAppCommand);
    register(OniroCommands.UNINSTALL_APP, uninstallCommand);
    register(OniroCommands.SCREENSHOT, screenshotCommand);
    register(OniroCommands.SHOW_LAST_CRASH, showLastCrashCommand);
    register(OniroCommands.RUN_DOCTOR, () => runDoctorCheck());
    register(OniroCommands.SEARCH_API, () => {
        const editor = vscode.window.activeTextEditor;
        const word = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : undefined;
        return searchApiCommand(word);
    });
    register(OniroCommands.SEARCH_DOCS, () => {
        const editor = vscode.window.activeTextEditor;
        const word = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : undefined;
        return searchDocsCommand(word);
    });
    register(OniroCommands.SYNC_DOCS, syncDocsCommand);
    register(OniroCommands.REFRESH_TREE, refreshStatus);
    register(OniroCommands.SHOW_LOG, () => oniroLogChannel.show());

    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('oniro-debug', new OniroDebugConfigurationProvider()),
        vscode.tasks.registerTaskProvider(OniroTaskProvider.OniroType, new OniroTaskProvider()),
    );

    registerHilogViewerCommand(context);
    registerSdkManagerCommand(context);
    registerCreateProjectCommand(context);
    registerBuildConfigCommand(context);
}

export function deactivate(): Thenable<void> | undefined {
    return stopLanguageClient();
}
