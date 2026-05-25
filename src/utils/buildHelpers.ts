import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { readJson5File, runHvigorw, type RunHvigorwOptions } from '@oniroproject/core';
import { oniroLogChannel } from './logger';
import { vscodeConfigProvider, vscodeLogger } from '../adapters';

/**
 * Verify build-profile.json5 exists and declares at least one signing config.
 * Shows a warning + throws if it doesn't — callers should propagate the error to the user.
 */
export function ensureSigningConfigs(projectDir: string): void {
    const buildProfilePath = path.join(projectDir, 'build-profile.json5');
    if (!fs.existsSync(buildProfilePath)) {
        vscode.window.showWarningMessage(
            'build-profile.json5 not found. Please generate signing configs first using the Oniro: Sign App command.',
        );
        throw new Error('build-profile.json5 not found');
    }

    try {
        const profile = readJson5File<{ app?: { signingConfigs?: unknown[] } }>(buildProfilePath);
        const configs = profile?.app?.signingConfigs;
        if (!Array.isArray(configs) || configs.length === 0) {
            vscode.window.showWarningMessage(
                'No signing configs found in build-profile.json5. Please generate them first using the Oniro: Sign App command.',
            );
            throw new Error('Missing signing configs in build-profile.json5');
        }
    } catch (err) {
        if (err instanceof Error && err.message.startsWith('Missing signing configs')) {
            throw err;
        }
        oniroLogChannel.appendLine(`[build] Error reading/parsing build-profile.json5: ${err}`);
        vscode.window.showWarningMessage(
            'Could not read or parse build-profile.json5. Please ensure it exists and is valid, and generate signing configs if needed.',
        );
        throw err;
    }
}

/**
 * Resolve the workspace root, or throw with a user-friendly error.
 */
export function getWorkspaceRoot(): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error('No workspace folder found.');
    }
    return workspaceFolders[0].uri.fsPath;
}

/**
 * Build via core's runHvigorw, streaming output to the Oniro log channel.
 */
export async function runBuild(opts: {
    projectDir: string;
    product?: string;
    module?: string;
    buildMode?: string;
}): Promise<void> {
    ensureSigningConfigs(opts.projectDir);

    const options: RunHvigorwOptions = {
        config: vscodeConfigProvider,
        projectDir: opts.projectDir,
        product: opts.product,
        module: opts.module,
        buildMode: opts.buildMode,
        task: 'assembleHap',
        logger: vscodeLogger,
        onOutput: (chunk) => oniroLogChannel.append(chunk),
    };

    oniroLogChannel.appendLine(`[build] Running hvigorw assembleHap (product=${opts.product ?? 'default'}, module=${opts.module ?? '-'}, mode=${opts.buildMode ?? '-'})`);
    oniroLogChannel.show(true);
    const { exitCode } = await runHvigorw(options);
    if (exitCode !== 0) {
        throw new Error(`Build failed with exit code ${exitCode}`);
    }
    oniroLogChannel.appendLine('[build] Build complete.');
}
