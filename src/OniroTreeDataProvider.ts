import * as vscode from 'vscode';
import { isUsableDevice } from '@oniroproject/core';
import { OniroCommands } from './commandIds';
import { describeDevice, type DeviceManager } from './device';
import { doctorCheckTitle, lastDoctorReport } from './doctor';
import { cachedEmulatorStatus } from './emulator';
import { isOhosProject, tryGetWorkspaceRoot } from './utils/project';

export { OniroCommands } from './commandIds';

type Section = 'project' | 'device' | 'emulator' | 'tools' | 'doctor';

class SectionItem extends vscode.TreeItem {
    constructor(readonly section: Section, label: string, icon: string, expanded = true) {
        super(label, expanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = new vscode.ThemeIcon(icon);
        this.contextValue = `section.${section}`;
        this.id = `section.${section}`;
    }
}

function action(label: string, command: string, icon: string, tooltip: string, description?: string): vscode.TreeItem {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.command = { command, title: label };
    item.iconPath = new vscode.ThemeIcon(icon);
    item.tooltip = tooltip;
    item.description = description;
    return item;
}

const HEALTH_ICON: Record<string, [string, string?]> = {
    ready: ['pass-filled', 'testing.iconPassed'],
    booting: ['loading~spin'],
    stuck: ['warning', 'list.warningForeground'],
    'hdc-lost': ['debug-disconnect', 'list.warningForeground'],
    stopped: ['circle-outline'],
};

const DOCTOR_ICON: Record<string, [string, string?]> = {
    ok: ['pass', 'testing.iconPassed'],
    warn: ['warning', 'list.warningForeground'],
    fail: ['error', 'list.errorForeground'],
    skip: ['circle-slash'],
};

function themeIcon([id, color]: [string, string?]): vscode.ThemeIcon {
    return new vscode.ThemeIcon(id, color ? new vscode.ThemeColor(color) : undefined);
}

export class OniroTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private readonly emitter = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this.emitter.event;

    constructor(private readonly devices: DeviceManager) {}

    refresh(): void {
        this.emitter.fire();
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
        if (!element) {
            const sections: vscode.TreeItem[] = [];
            if (isOhosProject(tryGetWorkspaceRoot())) {
                sections.push(new SectionItem('project', 'Project', 'project'));
            }
            sections.push(
                new SectionItem('device', 'Device', 'device-mobile'),
                new SectionItem('emulator', 'Emulator', 'vm'),
                new SectionItem('tools', 'Tools', 'tools'),
            );
            const report = lastDoctorReport();
            if (report) {
                const s = new SectionItem('doctor', 'Doctor', report.ok ? 'pass' : 'error', !report.ok);
                s.description = report.ok ? 'ready' : `${report.checks.filter((c) => c.status === 'fail').length} problem(s)`;
                sections.push(s);
            }
            return sections;
        }
        if (!(element instanceof SectionItem)) {
            return [];
        }
        switch (element.section) {
            case 'project': return this.projectItems();
            case 'device': return this.deviceItems();
            case 'emulator': return this.emulatorItems();
            case 'tools': return this.toolItems();
            case 'doctor': return this.doctorItems();
        }
    }

    private projectItems(): vscode.TreeItem[] {
        return [
            action('Run All', OniroCommands.RUN_ALL, 'play-circle', 'Build, install and launch on the target device (starts the emulator when no device is connected).'),
            action('Build', OniroCommands.QUICK_BUILD, 'package', 'Build the default product; errors go to the Problems panel.'),
            action('Build…', OniroCommands.BUILD, 'settings', 'Pick the product, module and build mode.'),
            action('Sign', OniroCommands.SIGN, 'key', 'Write signing configs: OpenHarmony development material, or AppGallery Connect material for a HarmonyOS product.'),
            action('Check ArkTS', OniroCommands.CHECK_ARKTS, 'checklist', 'Type-check and lint the ArkTS sources in seconds, without a build.'),
            action('Run Tests', 'workbench.view.testing.focus', 'beaker', 'Run the ohosTest suites on the device from the Test Explorer.'),
        ];
    }

    private deviceItems(): vscode.TreeItem[] {
        const serial = this.devices.selectedSerial;
        const known = this.devices.knownDevices;
        const usable = known.filter(isUsableDevice);
        let label: string;
        let desc: string | undefined;
        if (serial) {
            const d = known.find((x) => x.serial === serial);
            label = d ? describeDevice(d) : serial;
            desc = d ? d.status : 'not connected';
        } else if (usable.length === 1) {
            label = describeDevice(usable[0]);
            desc = 'auto';
        } else {
            label = usable.length > 1 ? `${usable.length} devices connected` : 'No device connected';
            desc = usable.length > 1 ? 'pick one' : undefined;
        }
        const target = action(label, OniroCommands.SELECT_DEVICE, 'device-mobile', this.devices.lastRefreshError ?? 'Click to pick the target device.', desc);
        target.contextValue = 'device.target';
        return [
            target,
            action('Install App', OniroCommands.INSTALL_APP, 'cloud-upload', 'Install the built HAP on the target device.'),
            action('Launch App', OniroCommands.LAUNCH_APP, 'rocket', 'Launch the app and follow its log.'),
            action('Stop App', OniroCommands.STOP_APP, 'debug-stop', 'Force-stop the app.'),
            action('Uninstall App', OniroCommands.UNINSTALL_APP, 'trash', 'Uninstall the app (its data is deleted).'),
            action('Screenshot', OniroCommands.SCREENSHOT, 'device-camera', 'Capture the device screen.'),
            action('HiLog Viewer', OniroCommands.SHOW_HILOG_VIEWER, 'output', 'Stream and filter the device log.'),
            action('Last Crash', OniroCommands.SHOW_LAST_CRASH, 'bug', "Fetch and explain the app's newest crash or freeze, with the line in your code."),
        ];
    }

    private emulatorItems(): vscode.TreeItem[] {
        const status = cachedEmulatorStatus();
        const items: vscode.TreeItem[] = [];
        if (status) {
            const inst = status.instances.find((i) => i.instance === 0);
            const state = !status.installed ? 'not installed' : inst?.state ?? (status.running ? 'running' : 'stopped');
            const s = new vscode.TreeItem(`Status: ${state}`, vscode.TreeItemCollapsibleState.None);
            s.iconPath = status.installed ? themeIcon(HEALTH_ICON[state] ?? ['circle-outline']) : new vscode.ThemeIcon('cloud-download');
            s.description = status.connected ? status.address : undefined;
            s.tooltip = status.installed ? `${status.dir}${inst?.bootSeconds ? `\nBooted in ${inst.bootSeconds} s` : ''}` : 'Install it from the SDK Manager.';
            if (!status.installed) {
                s.command = { command: OniroCommands.OPEN_SDK_MANAGER, title: 'Open SDK Manager' };
            }
            items.push(s);
        }
        items.push(
            action('Start Emulator', OniroCommands.START_EMULATOR, 'vm-running', 'Start the Oniro emulator and wait until it has booted.'),
            action('Stop Emulator', OniroCommands.STOP_EMULATOR, 'vm-outline', 'Stop the Oniro emulator.'),
            action('Connect Emulator', OniroCommands.CONNECT_EMULATOR, 'plug', 'Connect hdc to a running emulator.'),
        );
        return items;
    }

    private toolItems(): vscode.TreeItem[] {
        return [
            action('Create Project', OniroCommands.CREATE_PROJECT, 'new-folder', 'Create a new OpenHarmony or HarmonyOS project from a template.'),
            action('SDK Manager', OniroCommands.OPEN_SDK_MANAGER, 'library', 'Install SDKs, command-line tools and the emulator.'),
            action('Doctor', OniroCommands.RUN_DOCTOR, 'heart', 'Check that this machine can build, sign, install and test, with a fix for each problem.'),
            action('Search API', OniroCommands.SEARCH_API, 'symbol-method', "Search the SDK's declarations."),
            action('Search Docs', OniroCommands.SEARCH_DOCS, 'book', 'Search the OpenHarmony application-development docs.'),
        ];
    }

    private doctorItems(): vscode.TreeItem[] {
        const report = lastDoctorReport();
        if (!report) { return []; }
        return report.checks.map((c) => {
            const item = new vscode.TreeItem(doctorCheckTitle(c.id), vscode.TreeItemCollapsibleState.None);
            item.description = c.detail;
            item.iconPath = themeIcon(DOCTOR_ICON[c.status] ?? ['circle-outline']);
            item.tooltip = new vscode.MarkdownString(`**${doctorCheckTitle(c.id)}**: ${c.detail}${c.fix ? `\n\nFix: ${c.fix}` : ''}`);
            return item;
        });
    }
}
