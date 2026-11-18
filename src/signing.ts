import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    type HarmonyOsSession,
    type HuaweiUserInfo,
    createHarmonyOsSession,
    describeProfileValidity,
    describeSigningMaterial,
    detectRuntimeOs,
    discoverHaps,
    formatHapVerification,
    generateSigningConfigs,
    getOhosBaseSdkHome,
    harmonyOsAutoSign,
    harmonyOsSignHap,
    readHapSigningInfo,
    signOpenHarmonyHap,
    verifyHap,
} from '@oniroproject/core';
import { vscodeConfigProvider, vscodeLogger } from './adapters';
import { OniroCommands } from './commandIds';
import { codeBlock, escapeMd, showMarkdownReport } from './report';
import { oniroLogChannel } from './utils/logger';
import { errorMessage, getProjectDir, listProducts, tryGetWorkspaceRoot } from './utils/project';

function session(): HarmonyOsSession {
    return createHarmonyOsSession({ config: vscodeConfigProvider, logger: vscodeLogger });
}

/**
 * Sign in to a Huawei developer account in the browser. The token is stored where
 * `oniro-app auth login` keeps it, so the CLI and the extension share one sign-in.
 */
export async function harmonyOsLogin(): Promise<HuaweiUserInfo | undefined> {
    let loginUrl: string | undefined;
    const s = createHarmonyOsSession({
        config: vscodeConfigProvider,
        logger: vscodeLogger,
        onLoginUrl: (url) => {
            loginUrl = url;
            oniroLogChannel.appendLine(`[auth] Sign-in URL: ${url}`);
            void vscode.env.openExternal(vscode.Uri.parse(url));
        },
    });
    try {
        const user = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Oniro: Waiting for the Huawei sign-in to complete in your browser…',
            cancellable: false,
        }, () => s.login({ openBrowser: false }));
        vscode.window.showInformationMessage(`Signed in to Huawei as ${user.userName} (${user.siteCode}).`);
        return user;
    } catch (err) {
        const extra = loginUrl ? ' The sign-in URL is in the Oniro Log.' : '';
        vscode.window.showErrorMessage(`Huawei sign-in failed: ${errorMessage(err)}${extra}`);
        return undefined;
    }
}

export async function harmonyOsLogout(): Promise<void> {
    try {
        const ended = await session().logout();
        vscode.window.showInformationMessage(ended ? 'Signed out of the Huawei account.' : 'No Huawei account was signed in.');
    } catch (err) {
        vscode.window.showErrorMessage(`Sign-out failed: ${errorMessage(err)}`);
    }
}

/** The signed-in Huawei session, offering a sign-in when there is none. */
async function requireHarmonyOsSession(): Promise<HarmonyOsSession | undefined> {
    const s = session();
    let user: HuaweiUserInfo | null = null;
    try {
        user = await s.getUserInfo();
    } catch (err) {
        oniroLogChannel.appendLine(`[auth] Could not read the stored session: ${errorMessage(err)}`);
    }
    if (user) {
        return s;
    }
    const choice = await vscode.window.showInformationMessage(
        'Signing a HarmonyOS app needs a debug certificate from AppGallery Connect. Sign in with your Huawei developer account?',
        { modal: true },
        'Sign In',
    );
    if (choice !== 'Sign In') {
        return undefined;
    }
    return (await harmonyOsLogin()) ? session() : undefined;
}

/** Ask which product to sign when the project declares more than one. */
async function pickProduct(projectDir: string, preset?: string): Promise<string | undefined | null> {
    if (preset) { return preset; }
    const products = listProducts(projectDir);
    if (products.length <= 1) { return products[0]; }
    const picked = await vscode.window.showQuickPick(
        products.map((p) => ({ label: p, description: detectRuntimeOs(projectDir, p) })),
        { title: 'Oniro: Sign', placeHolder: 'Which product should be signed?' },
    );
    return picked ? picked.label : null;
}

/**
 * Write signing configs for the project: offline OpenHarmony development material,
 * or, for a HarmonyOS product, AGC debug material for the signed-in account.
 * Resolves true when the project ends up with signing configs.
 */
export async function signProject(projectDir: string, presetProduct?: string): Promise<boolean> {
    const product = await pickProduct(projectDir, presetProduct);
    if (product === null) { return false; }
    const runtime = detectRuntimeOs(projectDir, product);

    try {
        if (runtime === 'HarmonyOS') {
            const s = await requireHarmonyOsSession();
            if (!s) { return false; }
            const result = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Oniro: Getting HarmonyOS debug signing material from AppGallery Connect…',
            }, () => harmonyOsAutoSign({
                config: vscodeConfigProvider,
                session: s,
                projectDir,
                productName: product,
                logger: vscodeLogger,
            }));
            const validity = describeProfileValidity({ type: result.profileType, notAfter: result.notAfter });
            const devices = `${result.deviceIds.length} device${result.deviceIds.length === 1 ? '' : 's'}`;
            const verb = result.regenerated ? 'Signing configs written' : 'Existing signing material is still valid';
            oniroLogChannel.appendLine(`[sign] ${verb} for ${result.bundleName}: ${validity}, ${devices}.`);
            vscode.window.showInformationMessage(`${verb} for ${result.bundleName} (profile names ${devices}${validity ? `, ${validity}` : ''}).`);
            return true;
        }

        oniroLogChannel.appendLine(`[sign] Generating OpenHarmony signing configs${product ? ` for product ${product}` : ''}…`);
        const result = generateSigningConfigs({
            projectDir,
            sdkHome: getOhosBaseSdkHome(vscodeConfigProvider),
            product,
            logger: vscodeLogger,
        });
        const summary = describeSigningMaterial(result);
        oniroLogChannel.appendLine(`[sign] Signing configs written to build-profile.json5 (${result.signaturesDir}). ${summary}`);
        vscode.window.showInformationMessage(`Signing configs ready${summary ? `: ${summary}` : '.'}`);
        return true;
    } catch (err) {
        const message = errorMessage(err);
        oniroLogChannel.appendLine(`[sign] ${message}`);
        const actions = /java/i.test(message) ? ['Run Doctor'] : [];
        const choice = await vscode.window.showErrorMessage(`Signing failed: ${message}`, ...actions);
        if (choice === 'Run Doctor') {
            await vscode.commands.executeCommand(OniroCommands.RUN_DOCTOR);
        }
        return false;
    }
}

export async function signCommand(): Promise<void> {
    let projectDir: string;
    try {
        projectDir = getProjectDir();
    } catch (err) {
        vscode.window.showErrorMessage(errorMessage(err));
        return;
    }
    await signProject(projectDir);
}

/** Built HAPs of the workspace project, newest first, for the HAP pickers. */
async function workspaceHaps(): Promise<string[]> {
    const dir = tryGetWorkspaceRoot();
    if (!dir) { return []; }
    try {
        const grouped = await discoverHaps({ projectDir: dir });
        return Object.values(grouped)
            .flatMap((m) => [...m.signed, ...m.unsigned])
            .filter((p) => fs.existsSync(p))
            .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    } catch {
        return [];
    }
}

async function pickHap(title: string): Promise<string | undefined> {
    const dir = tryGetWorkspaceRoot();
    type Item = vscode.QuickPickItem & { file?: string };
    const items: Item[] = (await workspaceHaps()).map((file) => ({
        label: path.basename(file),
        description: dir ? path.relative(dir, path.dirname(file)) : path.dirname(file),
        file,
    }));
    items.push({ label: '$(folder-opened) Browse…' });
    const picked = items.length === 1 ? items[0] : await vscode.window.showQuickPick(items, { title, placeHolder: 'Pick a HAP' });
    if (!picked) { return undefined; }
    if (picked.file) { return picked.file; }
    const uris = await vscode.window.showOpenDialog({
        title,
        canSelectMany: false,
        filters: { 'HAP packages': ['hap'] },
        defaultUri: dir ? vscode.Uri.file(dir) : undefined,
    });
    return uris?.[0]?.fsPath;
}

/** Sign a prebuilt HAP, with no project: OpenHarmony offline, HarmonyOS through AGC. */
export async function signHapCommand(uri?: vscode.Uri): Promise<void> {
    const hapPath = uri?.fsPath ?? await pickHap('Oniro: Sign HAP');
    if (!hapPath) { return; }
    try {
        const info = await readHapSigningInfo(hapPath);
        if (info.compileSdkType === 'HarmonyOS') {
            const s = await requireHarmonyOsSession();
            if (!s) { return; }
            const result = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Oniro: Signing ${path.basename(hapPath)} for HarmonyOS…`,
            }, () => harmonyOsSignHap({ config: vscodeConfigProvider, session: s, hapPath, logger: vscodeLogger }));
            vscode.window.showInformationMessage(`Signed ${result.bundleName} for HarmonyOS: ${result.outPath}`);
            return;
        }
        const result = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Oniro: Signing ${path.basename(hapPath)}…`,
        }, () => signOpenHarmonyHap({
            hapPath,
            sdkHome: getOhosBaseSdkHome(vscodeConfigProvider),
            logger: vscodeLogger,
        }));
        const summary = describeSigningMaterial(result.material);
        oniroLogChannel.appendLine(`[sign] Signed ${hapPath} → ${result.outPath} with API ${result.sdkApi} material. ${summary}`);
        vscode.window.showInformationMessage(`Signed ${result.bundleName}: ${result.outPath}`);
    } catch (err) {
        vscode.window.showErrorMessage(`Signing the HAP failed: ${errorMessage(err)}`);
    }
}

/** Verify a HAP's signature and show what signed it. */
export async function verifyHapCommand(uri?: vscode.Uri): Promise<void> {
    const hapPath = uri?.fsPath ?? await pickHap('Oniro: Verify HAP Signature');
    if (!hapPath) { return; }
    try {
        const result = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Oniro: Verifying ${path.basename(hapPath)}…`,
        }, () => verifyHap({ hapPath, config: vscodeConfigProvider, logger: vscodeLogger }));
        const icon = result.status === 'valid' ? '✅' : result.status === 'invalid' ? '❌' : '⚠️';
        const md = [
            `# ${icon} HAP signature: ${result.status}`,
            '',
            `**File:** ${escapeMd(hapPath)}`,
            '',
            codeBlock(formatHapVerification(result)),
            '',
        ].join('\n');
        await showMarkdownReport('hap-verification', md);
    } catch (err) {
        vscode.window.showErrorMessage(`Verifying the HAP failed: ${errorMessage(err)}`);
    }
}
