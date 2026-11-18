import * as vscode from 'vscode';
import {
    type DeviceFullInfo,
    type DeviceInfo,
    getDeviceInfo,
    isUsableDevice,
    listDevices,
} from '@oniroproject/core';
import { vscodeConfigProvider, vscodeLogger } from './adapters';
import { OniroCommands } from './commandIds';
import { errorMessage } from './utils/project';

const STATE_KEY = 'oniro.deviceSerial';
const ENV_VAR = 'ONIRO_DEVICE_SERIAL';

export interface DeviceSummary extends DeviceInfo {
    info?: DeviceFullInfo;
}

/** One line describing a device: `Oniro (OpenHarmony API 23, x86_64)`. */
export function describeDevice(d: DeviceSummary): string {
    const info = d.info;
    if (!info) { return d.serial; }
    const parts: string[] = [];
    const os = info.osFamily === 'HarmonyOS'
        ? `HarmonyOS${info.osDistVersion ? ` ${info.osDistVersion}` : ''}`
        : 'OpenHarmony';
    parts.push(info.sdkApiVersion ? `${os} API ${info.sdkApiVersion}` : os);
    if (info.abi) { parts.push(info.abi.split(',')[0]); }
    const name = info.model || info.brand || d.serial;
    return `${name} (${parts.join(', ')})`;
}

/**
 * Which device the extension addresses. Every core call that talks to hdc reads the
 * `ONIRO_DEVICE_SERIAL` env var when no serial is passed, so the selection is applied
 * there (in this extension host) as well as passed explicitly where an API takes it.
 * The same variable is exported to integrated terminals, so `oniro-app` run there
 * targets the same device.
 */
export class DeviceManager implements vscode.Disposable {
    private readonly statusItem: vscode.StatusBarItem;
    private readonly emitter = new vscode.EventEmitter<void>();
    readonly onDidChange = this.emitter.event;
    private readonly initialEnv: string | undefined;
    private devices: DeviceSummary[] = [];
    private lastError: string | undefined;
    /** Device properties by serial: they do not change while a device stays connected. */
    private readonly infoCache = new Map<string, DeviceFullInfo>();

    constructor(private readonly context: vscode.ExtensionContext) {
        this.initialEnv = process.env[ENV_VAR];
        this.statusItem = vscode.window.createStatusBarItem('oniro.device', vscode.StatusBarAlignment.Left, 50);
        this.statusItem.name = 'Oniro Device';
        this.statusItem.command = OniroCommands.SELECT_DEVICE;
        this.apply(this.selectedSerial);
        this.statusItem.show();
    }

    dispose(): void {
        this.statusItem.dispose();
        this.emitter.dispose();
    }

    /** The serial picked by the user, or undefined for "let hdc choose". */
    get selectedSerial(): string | undefined {
        return this.context.workspaceState.get<string>(STATE_KEY) || undefined;
    }

    /** The serial core should address: the selection, else an inherited env var. */
    get effectiveSerial(): string | undefined {
        return this.selectedSerial ?? this.initialEnv;
    }

    /** Devices seen by the last {@link refresh}. */
    get knownDevices(): readonly DeviceSummary[] {
        return this.devices;
    }

    get lastRefreshError(): string | undefined {
        return this.lastError;
    }

    async select(serial: string | undefined): Promise<void> {
        await this.context.workspaceState.update(STATE_KEY, serial);
        this.apply(serial);
        this.emitter.fire();
    }

    private apply(serial: string | undefined): void {
        const value = serial ?? this.initialEnv;
        if (value) {
            process.env[ENV_VAR] = value;
            this.context.environmentVariableCollection.replace(ENV_VAR, value);
        } else {
            delete process.env[ENV_VAR];
            this.context.environmentVariableCollection.delete(ENV_VAR);
        }
        this.updateStatus();
    }

    private updateStatus(): void {
        const serial = this.selectedSerial;
        const known = serial ? this.devices.find((d) => d.serial === serial) : undefined;
        if (serial) {
            const label = known?.info?.model || serial;
            const offline = this.devices.length > 0 && !known;
            this.statusItem.text = `$(device-mobile) ${label}${offline ? ' (not connected)' : ''}`;
            this.statusItem.tooltip = `Oniro target device: ${known ? describeDevice(known) : serial}\nClick to change.`;
        } else {
            const usable = this.devices.filter(isUsableDevice);
            const text = usable.length === 1 ? (usable[0].info?.model || usable[0].serial) : usable.length > 1 ? `${usable.length} devices` : 'No device';
            this.statusItem.text = `$(device-mobile) ${text}`;
            this.statusItem.tooltip = usable.length > 1
                ? 'Several devices are connected: click to pick the one Oniro commands target.'
                : 'Oniro target device: the single connected device (auto). Click to pick one.';
        }
    }

    /** Re-read `hdc list targets` (and each device's model/API). Never throws. */
    async refresh(withInfo = true): Promise<readonly DeviceSummary[]> {
        try {
            const listed = await listDevices(vscodeConfigProvider, { timeoutMs: 8000, logger: vscodeLogger });
            const usable = new Set(listed.filter(isUsableDevice).map((d) => d.serial));
            for (const serial of this.infoCache.keys()) {
                if (!usable.has(serial)) { this.infoCache.delete(serial); }
            }
            this.devices = await Promise.all(listed.map(async (d): Promise<DeviceSummary> => {
                if (!isUsableDevice(d)) { return d; }
                const cached = this.infoCache.get(d.serial);
                if (cached || !withInfo) { return cached ? { ...d, info: cached } : d; }
                try {
                    const info = await getDeviceInfo({ config: vscodeConfigProvider, deviceSerial: d.serial, timeoutMs: 8000, logger: vscodeLogger });
                    this.infoCache.set(d.serial, info);
                    return { ...d, info };
                } catch {
                    return d;
                }
            }));
            this.lastError = undefined;
        } catch (err) {
            this.devices = [];
            this.lastError = errorMessage(err);
        }
        this.updateStatus();
        this.emitter.fire();
        return this.devices;
    }

    /** Quick pick of connected devices; updates the selection. */
    async pick(): Promise<void> {
        type Item = vscode.QuickPickItem & { serial?: string; action?: 'auto' | 'emulator' };
        const qp = vscode.window.createQuickPick<Item>();
        qp.title = 'Oniro: Select Target Device';
        qp.placeholder = 'Listing devices…';
        qp.busy = true;
        let accepted: Item | undefined;
        const choice = new Promise<Item | undefined>((resolve) => {
            qp.onDidAccept(() => { accepted = qp.selectedItems[0]; resolve(accepted); });
            qp.onDidHide(() => resolve(undefined));
        });
        qp.show();

        let hidden = false;
        void choice.then(() => { hidden = true; });
        const devices = await this.refresh();
        if (hidden && !accepted) {
            qp.dispose();
            return;
        }
        const selected = this.selectedSerial;
        const items: Item[] = [
            {
                label: '$(sync) Auto',
                description: selected ? '' : 'current',
                detail: 'Use the single connected device (hdc picks it).',
                action: 'auto',
            },
        ];
        if (devices.length > 0) {
            items.push({ label: 'Connected', kind: vscode.QuickPickItemKind.Separator });
        }
        for (const d of devices) {
            items.push({
                label: `$(device-mobile) ${d.info?.model || d.serial}`,
                description: [d.serial, d.status, d.serial === selected ? 'current' : ''].filter(Boolean).join(' · '),
                detail: d.info ? describeDevice(d) : undefined,
                serial: d.serial,
            });
        }
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({ label: '$(vm-running) Start Oniro Emulator', action: 'emulator' });

        qp.items = items;
        qp.busy = false;
        qp.placeholder = this.lastError
            ? `Could not list devices: ${this.lastError}`
            : devices.length === 0 ? 'No device connected' : 'Pick the device Oniro commands target';

        const picked = await choice;
        qp.dispose();
        if (!picked) { return; }
        if (picked.action === 'emulator') {
            await vscode.commands.executeCommand(OniroCommands.START_EMULATOR);
            return;
        }
        await this.select(picked.action === 'auto' ? undefined : picked.serial);
    }
}
