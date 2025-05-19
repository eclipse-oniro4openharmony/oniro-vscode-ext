import * as vscode from 'vscode';

export class OniroTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor() {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (element) {
            // For now, we don't have any nested items
            return Promise.resolve([]);
        } else {
            // Root level items
            const runAllItem = new vscode.TreeItem('Run All', vscode.TreeItemCollapsibleState.None);
            runAllItem.command = {
                command: OniroCommands.RUN_ALL,
                title: 'Run All Oniro Steps',
                arguments: []
            };
            runAllItem.tooltip = 'Starts emulator, builds, installs, and launches the app.';
            runAllItem.iconPath = new vscode.ThemeIcon('play-circle');

            const initSdkItem = new vscode.TreeItem('Initialize SDK', vscode.TreeItemCollapsibleState.None);
            initSdkItem.command = {
                command: OniroCommands.INIT_SDK,
                title: 'Initialize Oniro SDK'
            };
            initSdkItem.tooltip = 'Initializes the Oniro SDK.';
            initSdkItem.iconPath = new vscode.ThemeIcon('cloud-download');

            const buildItem = new vscode.TreeItem('Build', vscode.TreeItemCollapsibleState.None);
            buildItem.command = {
                command: OniroCommands.BUILD,
                title: 'Build Oniro App'
            };
            buildItem.tooltip = 'Builds the Oniro application.';
            buildItem.iconPath = new vscode.ThemeIcon('package');

            const signItem = new vscode.TreeItem('Sign', vscode.TreeItemCollapsibleState.None);
            signItem.command = {
                command: OniroCommands.SIGN,
                title: 'Sign Oniro App'
            };
            signItem.tooltip = 'Signs the Oniro application.';
            signItem.iconPath = new vscode.ThemeIcon('key');

            const startEmulatorItem = new vscode.TreeItem('Start Emulator', vscode.TreeItemCollapsibleState.None);
            startEmulatorItem.command = {
                command: OniroCommands.START_EMULATOR,
                title: 'Start Emulator'
            };
            startEmulatorItem.tooltip = 'Starts the Oniro emulator.';
            startEmulatorItem.iconPath = new vscode.ThemeIcon('vm-running');

            const stopEmulatorItem = new vscode.TreeItem('Stop Emulator', vscode.TreeItemCollapsibleState.None);
            stopEmulatorItem.command = {
                command: OniroCommands.STOP_EMULATOR,
                title: 'Stop Emulator'
            };
            stopEmulatorItem.tooltip = 'Stops the Oniro emulator.';
            stopEmulatorItem.iconPath = new vscode.ThemeIcon('vm-outline');

            const connectEmulatorItem = new vscode.TreeItem('Connect Emulator', vscode.TreeItemCollapsibleState.None);
            connectEmulatorItem.command = {
                command: OniroCommands.CONNECT_EMULATOR,
                title: 'Connect to Emulator'
            };
            connectEmulatorItem.tooltip = 'Connects to the running Oniro emulator.';
            connectEmulatorItem.iconPath = new vscode.ThemeIcon('zap');

            const installAppItem = new vscode.TreeItem('Install App', vscode.TreeItemCollapsibleState.None);
            installAppItem.command = {
                command: OniroCommands.INSTALL_APP,
                title: 'Install App'
            };
            installAppItem.tooltip = 'Installs the app on the emulator/device.';
            installAppItem.iconPath = new vscode.ThemeIcon('cloud-upload');

            const launchAppItem = new vscode.TreeItem('Launch App', vscode.TreeItemCollapsibleState.None);
            launchAppItem.command = {
                command: OniroCommands.LAUNCH_APP,
                title: 'Launch App'
            };
            launchAppItem.tooltip = 'Launches the app on the emulator/device.';
            launchAppItem.iconPath = new vscode.ThemeIcon('rocket');


            return Promise.resolve([
                runAllItem,
                initSdkItem,
                buildItem,
                signItem,
                startEmulatorItem,
                stopEmulatorItem,
                connectEmulatorItem,
                installAppItem,
                launchAppItem
            ]);
        }
    }
}

export class OniroCommands {
    public static readonly RUN_ALL = 'oniro-ide.runAll';
    public static readonly INIT_SDK = 'oniro-ide.initSdk';
    public static readonly BUILD = 'oniro-ide.build';
    public static readonly SIGN = 'oniro-ide.sign';
    public static readonly START_EMULATOR = 'oniro-ide.startEmulator';
    public static readonly STOP_EMULATOR = 'oniro-ide.stopEmulator';
    public static readonly CONNECT_EMULATOR = 'oniro-ide.connectEmulator';
    public static readonly INSTALL_APP = 'oniro-ide.installApp';
    public static readonly LAUNCH_APP = 'oniro-ide.launchApp';
    // Add other command constants if you create more tree items
}
