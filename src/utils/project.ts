import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { readJson5File } from '@oniroproject/core';

export type BuildProfile = {
    app?: {
        products?: Array<{ name: string; signingConfig?: string; runtimeOS?: string; compileSdkVersion?: string | number }>;
        buildModeSet?: Array<{ name: string }>;
        signingConfigs?: Array<Record<string, unknown>>;
    };
    modules?: Array<{ name: string; srcPath?: string }>;
};

/**
 * Resolve the workspace root, or throw with a user-friendly error.
 *
 * With several folders open, the first one holding a build-profile.json5 wins, so a
 * multi-root workspace whose first folder is not the app still works.
 */
export function getWorkspaceRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        throw new Error('No workspace folder is open. Open an OpenHarmony project folder first.');
    }
    const project = folders.find((f) => fs.existsSync(path.join(f.uri.fsPath, 'build-profile.json5')));
    return (project ?? folders[0]).uri.fsPath;
}

/** The workspace root, or undefined when nothing is open (for UI that must not throw). */
export function tryGetWorkspaceRoot(): string | undefined {
    try {
        return getWorkspaceRoot();
    } catch {
        return undefined;
    }
}

/** Whether `dir` looks like an OpenHarmony/HarmonyOS app project. */
export function isOhosProject(dir: string | undefined): dir is string {
    return !!dir && fs.existsSync(path.join(dir, 'build-profile.json5'));
}

/** The workspace's project directory, or throw a message naming what is missing. */
export function getProjectDir(): string {
    const dir = getWorkspaceRoot();
    if (!isOhosProject(dir)) {
        throw new Error(`${dir} is not an OpenHarmony project: it has no build-profile.json5.`);
    }
    return dir;
}

export function loadBuildProfile(projectDir: string): BuildProfile {
    const buildProfilePath = path.join(projectDir, 'build-profile.json5');
    if (!fs.existsSync(buildProfilePath)) {
        throw new Error('build-profile.json5 not found.');
    }
    return readJson5File<BuildProfile>(buildProfilePath);
}

/** Product names declared in build-profile.json5, in declaration order. */
export function listProducts(projectDir: string): string[] {
    try {
        return (loadBuildProfile(projectDir).app?.products ?? []).map((p) => p.name).filter(Boolean);
    } catch {
        return [];
    }
}

/** Whether the build profile declares at least one signing config. */
/**
 * Whether the project has signing configs and, given a product (or the one a build
 * picks without one: `default`, else the first), whether that product uses one of them.
 */
export function hasSigningConfigs(projectDir: string, product?: string): boolean {
    try {
        const app = loadBuildProfile(projectDir).app;
        const configs: Array<{ name?: string }> = Array.isArray(app?.signingConfigs) ? app!.signingConfigs : [];
        if (configs.length === 0) { return false; }
        if (product === undefined) { return true; }
        const products: Array<{ name?: string; signingConfig?: string }> = Array.isArray(app?.products) ? app!.products : [];
        const p = products.find((x) => x.name === product);
        if (!p) { return true; }
        return !!p.signingConfig && configs.some((c) => c.name === p.signingConfig);
    } catch {
        return false;
    }
}

/** Absolute path for a project-relative (or already absolute) file reported by core. */
export function resolveProjectFile(projectDir: string, file: string): string {
    return path.isAbsolute(file) ? file : path.join(projectDir, file);
}

/** Error text for a caught value. */
export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/** Whether an error is a user/abort cancellation from core or our own bridge. */
export function isCancellation(err: unknown): boolean {
    if (!(err instanceof Error)) { return false; }
    return err.name === 'CancelledError'
        || err.name === 'AbortError'
        || err.message === 'Download cancelled'
        || err.message === 'Cancelled by user';
}
