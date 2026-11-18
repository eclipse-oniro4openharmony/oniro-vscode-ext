import * as vscode from 'vscode';
import {
    type BuildReport,
    buildWithDiagnostics,
    describeBuildSdk,
} from '@oniroproject/core';
import { tokenToSignal, vscodeConfigProvider, vscodeLogger } from './adapters';
import { OniroDiagnostics, publishDiagnostics } from './diagnostics';
import { installSdkWithProgress } from './sdkInstall';
import { signProject } from './signing';
import { oniroLogChannel } from './utils/logger';
import { hasSigningConfigs, isCancellation, listProducts } from './utils/project';

export interface BuildRequest {
    projectDir: string;
    product?: string;
    module?: string;
    buildMode?: string;
    token?: vscode.CancellationToken;
}

/** A build that ran and failed; its diagnostics are already in the Problems panel. */
export class BuildError extends Error {
    constructor(message: string, readonly report: BuildReport) {
        super(message);
        this.name = 'BuildError';
    }
}

let diagnosticsRef: OniroDiagnostics | undefined;

export function initBuild(diagnostics: OniroDiagnostics): void {
    diagnosticsRef = diagnostics;
}

/**
 * Make sure the project can produce a signed HAP. Returns false when the user chose
 * to stop. An unsigned build is allowed (a HarmonyOS emulator installs one), but the
 * user is asked first since an OpenHarmony device rejects it.
 */
async function ensureSigned(req: BuildRequest): Promise<boolean> {
    const product = req.product ?? 'default';
    if (hasSigningConfigs(req.projectDir, product)) {
        return true;
    }
    const why = hasSigningConfigs(req.projectDir)
        ? `Product "${product}" has no signing config`
        : 'This project has no signing configs';
    const choice = await vscode.window.showWarningMessage(
        `${why}, so the build produces an unsigned HAP, which OpenHarmony devices refuse to install.`,
        'Sign and Build',
        'Build Unsigned',
    );
    if (choice === 'Build Unsigned') {
        return true;
    }
    if (choice === 'Sign and Build') {
        return signProject(req.projectDir, req.product);
    }
    return false;
}

function summarize(report: BuildReport): string {
    const { errors, warnings } = report.summary;
    const parts = [];
    if (errors) { parts.push(`${errors} error${errors === 1 ? '' : 's'}`); }
    if (warnings) { parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`); }
    return parts.join(', ');
}

/**
 * Build with hvigor through core's `buildWithDiagnostics`: output streams to the
 * Oniro Log channel, errors and warnings land in the Problems panel, and a missing
 * SDK can be installed on the spot. Resolves with the report of a passed build;
 * throws {@link BuildError} for a failed one, or `undefined`-ish cancellation when the
 * user backs out of signing.
 */
export async function runBuild(request: BuildRequest): Promise<BuildReport | undefined> {
    // hvigor builds the product named `default` unless told otherwise; a project
    // without one (say, products `oniro` and `harmonyos`) builds its first product.
    const products = listProducts(request.projectDir);
    const req: BuildRequest = !request.product && products.length > 0 && !products.includes('default')
        ? { ...request, product: products[0] }
        : request;
    if (!(await ensureSigned(req))) {
        return undefined;
    }

    const bridge = tokenToSignal(req.token);
    try {
        for (let attempt = 0; attempt < 2; attempt++) {
            oniroLogChannel.appendLine(`[build] hvigor assembleHap (product=${req.product ?? 'default'}, module=${req.module ?? 'all'}, mode=${req.buildMode ?? 'default'})`);
            oniroLogChannel.show(true);
            const report = await buildWithDiagnostics({
                config: vscodeConfigProvider,
                projectDir: req.projectDir,
                product: req.product,
                module: req.module,
                mode: req.buildMode,
                abortSignal: bridge.signal,
                logger: vscodeLogger,
                onOutput: (chunk) => oniroLogChannel.append(chunk),
            });

            if (diagnosticsRef) {
                publishDiagnostics(diagnosticsRef.build, req.projectDir, report.diagnostics);
            }
            for (const w of report.warnings) {
                oniroLogChannel.appendLine(`[build] warning: ${w}`);
            }
            if (report.sdk) {
                oniroLogChannel.appendLine(`[build] Built against ${describeBuildSdk(report.sdk)}.`);
            }

            if (report.ok) {
                const counts = summarize(report);
                oniroLogChannel.appendLine(`[build] Build passed in ${(report.durationMs / 1000).toFixed(1)} s${counts ? ` (${counts})` : ''}.`);
                return report;
            }

            if (report.missingSdk && attempt === 0) {
                const { api, version } = report.missingSdk;
                if (version) {
                    const choice = await vscode.window.showErrorMessage(
                        `This project compiles against OpenHarmony API ${api}, which is not installed.`,
                        `Install SDK ${version} and Build`,
                    );
                    if (choice && await installSdkWithProgress(version, api, bridge.signal)) {
                        continue;
                    }
                }
            }

            const counts = summarize(report);
            oniroLogChannel.appendLine(`[build] Build failed${report.failedTask ? ` in ${report.failedTask}` : ''}${counts ? ` (${counts})` : ''}.`);
            if (report.error) {
                oniroLogChannel.appendLine(`[build] ${report.error}`);
            }
            const headline = report.error?.split('\n')[0] ?? `Build failed with exit code ${report.exitCode}`;
            throw new BuildError(counts ? `${headline} (${counts}; see the Problems panel)` : headline, report);
        }
        return undefined;
    } finally {
        bridge.dispose();
    }
}

/** Show a build failure with a shortcut to the Problems panel. */
export async function reportBuildFailure(err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const hasProblems = err instanceof BuildError && err.report.diagnostics.length > 0;
    const actions = hasProblems ? ['Show Problems', 'Show Log'] : ['Show Log'];
    const choice = await vscode.window.showErrorMessage(`Build failed: ${message}`, ...actions);
    if (choice === 'Show Problems') {
        await vscode.commands.executeCommand('workbench.actions.view.problems');
    } else if (choice === 'Show Log') {
        oniroLogChannel.show();
    }
}

/**
 * {@link runBuild} behind a cancellable progress notification, reporting the result.
 * Resolves with the report of a passed build, else undefined.
 */
export async function buildWithProgress(req: Omit<BuildRequest, 'token'>): Promise<BuildReport | undefined> {
    try {
        const report = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Oniro: Building…',
            cancellable: true,
        }, (_progress, token) => runBuild({ ...req, token }));
        if (report) {
            const counts = summarize(report);
            vscode.window.showInformationMessage(`Build passed in ${(report.durationMs / 1000).toFixed(1)} s${counts ? ` (${counts})` : ''}.`);
        }
        return report;
    } catch (err) {
        if (isCancellation(err)) {
            vscode.window.showWarningMessage('Build cancelled.');
            return undefined;
        }
        await reportBuildFailure(err);
        return undefined;
    }
}
