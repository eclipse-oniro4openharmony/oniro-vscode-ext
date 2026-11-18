import * as vscode from 'vscode';
import { type DoctorReport, runDoctor } from '@oniroproject/core';
import { vscodeConfigProvider, vscodeLogger } from './adapters';
import type { DeviceManager } from './device';
import { escapeMd, showMarkdownReport } from './report';
import { errorMessage, isOhosProject, tryGetWorkspaceRoot } from './utils/project';

const ICONS: Record<string, string> = { ok: '✅', warn: '⚠️', fail: '❌', skip: '⏭️' };
const TITLES: Record<string, string> = {
    node: 'Node.js',
    java: 'Java (signing)',
    sdk: 'OpenHarmony SDK',
    cmdtools: 'Command-line tools',
    'cmdtools-flavour': 'Tools flavour',
    'arkts-check': 'ArkTS checker',
    hdc: 'hdc',
    device: 'Device',
    signing: 'Signing material',
    disk: 'Disk space',
};

export function doctorCheckTitle(id: string): string {
    return TITLES[id] ?? id;
}

let lastReport: DoctorReport | undefined;
const changed = new vscode.EventEmitter<void>();
export const onDidChangeDoctorReport = changed.event;
let devices: DeviceManager | undefined;

export function initDoctor(context: vscode.ExtensionContext, deviceManager: DeviceManager): void {
    devices = deviceManager;
    context.subscriptions.push(changed);
}

export function lastDoctorReport(): DoctorReport | undefined {
    return lastReport;
}

export function renderDoctorReport(r: DoctorReport): string {
    const lines = [`# Oniro Doctor: ${r.ok ? '✅ ready' : '❌ problems found'}`, ''];
    if (r.project) {
        const sdk = r.project.compileSdkVersion !== undefined ? `, compileSdkVersion ${r.project.compileSdkVersion}` : '';
        lines.push(`**Project:** ${escapeMd(r.project.dir)} (${r.project.runtimeOS}${sdk})`, '');
    }
    lines.push('| | Check | Result | Fix |', '|---|---|---|---|');
    for (const c of r.checks) {
        const fix = c.fixed ? 'fixed' : c.fix ? escapeMd(c.fix) : '';
        lines.push(`| ${ICONS[c.status] ?? ''} | ${doctorCheckTitle(c.id)} | ${escapeMd(c.detail)} | ${fix} |`);
    }
    const v = r.versions;
    const versions: Array<[string, string | undefined]> = [
        ['Node.js', v.node], ['Java', v.java], ['Command-line tools', v.cmdTools && `${v.cmdTools}${v.cmdToolsFlavour ? ` (${v.cmdToolsFlavour})` : ''}`],
        ['SDK', v.sdk], ['hdc', v.hdc], ['Device API', v.deviceApi],
    ];
    lines.push('', '## Versions in use', '');
    for (const [k, val] of versions) {
        if (val) { lines.push(`- **${k}:** ${escapeMd(val)}`); }
    }
    lines.push('');
    return lines.join('\n');
}

/**
 * Run core's doctor: one verdict on whether this machine can build, check, sign,
 * install and test the workspace project, with a fix for each problem.
 */
export async function runDoctorCheck(opts: { fix?: boolean; show?: boolean } = {}): Promise<DoctorReport | undefined> {
    const root = tryGetWorkspaceRoot();
    const projectDir = isOhosProject(root) ? root : undefined;
    try {
        const report = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: opts.fix ? 'Oniro Doctor: fixing…' : 'Oniro Doctor: checking the toolchain…',
        }, (progress) => runDoctor({
            config: vscodeConfigProvider,
            projectDir,
            fix: opts.fix,
            deviceSerial: devices?.effectiveSerial,
            logger: vscodeLogger,
            progress,
        }));
        lastReport = report;
        changed.fire();
        if (opts.show !== false) {
            await showMarkdownReport('doctor', renderDoctorReport(report));
            const sdkFixable = !opts.fix && projectDir && report.checks.some((c) => c.id === 'sdk' && c.status === 'fail');
            if (sdkFixable) {
                const choice = await vscode.window.showWarningMessage('The SDK this project compiles against is missing.', 'Install It');
                if (choice) {
                    return runDoctorCheck({ fix: true });
                }
            }
        }
        return report;
    } catch (err) {
        vscode.window.showErrorMessage(`Oniro Doctor failed: ${errorMessage(err)}`);
        return undefined;
    }
}
