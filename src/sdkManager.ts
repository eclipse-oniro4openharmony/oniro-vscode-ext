import * as vscode from 'vscode';
import { OniroCommands } from './OniroTreeDataProvider';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as http from 'http';
import { pipeline } from 'stream';
import { promisify } from 'util';
import * as crypto from 'crypto';
import * as tar from 'tar';
import { oniroLogChannel } from './utils/logger';
import extractZip from 'extract-zip';

export interface SdkInfo {
    version: string;
    api: string;
    installed: boolean;
}

function getSdkRootDir(): string {
    return path.join(os.homedir(), 'setup-ohos-sdk');
}

// Centralized SDK list
const ALL_SDKS = [
    { version: '4.0', api: '10' },
    { version: '4.1', api: '11' },
    { version: '5.0.0', api: '12' },
    { version: '5.0.1', api: '13' },
    { version: '5.0.2', api: '14' },
    { version: '5.0.3', api: '15' },
    { version: '5.1.0', api: '18' }
];

function getInstalledSdks(): string[] {
    const sdkRoot = getSdkRootDir();
    const versions = new Set<string>();
    if (!fs.existsSync(sdkRoot)) return [];
    for (const osFolder of ['linux', 'darwin', 'windows']) {
        const osPath = path.join(sdkRoot, osFolder);
        if (!fs.existsSync(osPath) || !fs.statSync(osPath).isDirectory()) continue;
        for (const api of fs.readdirSync(osPath)) {
            const apiPath = path.join(osPath, api);
            if (!fs.statSync(apiPath).isDirectory()) continue;
            versions.add(api);
        }
    }
    // Map API levels back to versions using the centralized ALL_SDKS list
    return ALL_SDKS.filter(sdk => versions.has(sdk.api)).map(sdk => sdk.version);
}

export function getAvailableSdks(): SdkInfo[] {
    const installedSdks = getInstalledSdks();
    return ALL_SDKS.map(sdk => ({ ...sdk, installed: installedSdks.includes(sdk.version) }));
}

export function getSdkManagerHtml(context: vscode.ExtensionContext, sdkList: SdkInfo[], cmdToolsStatus?: { installed: boolean, status: string }): string {
    const htmlPath = path.join(context.extensionPath, 'src', 'sdkManagerWebview.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    const sdkListHtml = sdkList.map(sdk => `
        <div class="sdk-item">
            <div class="sdk-info">
                <span class="sdk-version">OpenHarmony ${sdk.version}</span>
                <span class="sdk-api">API Level ${sdk.api}</span>
                <span class="sdk-status">${sdk.installed ? 'Installed' : 'Not installed'}</span>
            </div>
            <div class="sdk-actions">
                <input type="checkbox" class="sdk-checkbox" id="sdk-${sdk.version}" ${sdk.installed ? 'checked' : ''} disabled />
                ${
                    sdk.installed
                        ? `<button class="remove" onclick="removeSdk('${sdk.version}', '${sdk.api}')">Remove</button>`
                        : `<button onclick="downloadSdk('${sdk.version}', '${sdk.api}')">Download</button>`
                }
            </div>
        </div>
    `).join('');
    html = html.replace('<!-- SDK_LIST_PLACEHOLDER -->', sdkListHtml);
    // Inject command line tools status if available
    if (cmdToolsStatus) {
        html = html.replace(
            'id="cmd-tools-status">Checking...</span>',
            `id="cmd-tools-status">${cmdToolsStatus.status}</span>`
        );
        html = html.replace(
            'id="cmd-tools-install" style="display:none"',
            `id="cmd-tools-install" style="display:${cmdToolsStatus.installed ? 'none' : ''}"`
        );
        html = html.replace(
            'id="cmd-tools-remove" class="remove" style="display:none"',
            `id="cmd-tools-remove" class="remove" style="display:${cmdToolsStatus.installed ? '' : 'none'}"`
        );
    }
    return html;
}

// Command line tools install location and check helpers
const CMD_TOOLS_PATH = path.join(os.homedir(), 'setup-ohos-sdk', 'cmd-tools');
const CMD_TOOLS_BIN = path.join(CMD_TOOLS_PATH, 'bin', 'ohpm');

export function isCmdToolsInstalled(): boolean {
    return fs.existsSync(CMD_TOOLS_BIN);
}

export function getCmdToolsStatus(): { installed: boolean, status: string } {
    if (isCmdToolsInstalled()) {
        try {
            const version = require('child_process').execFileSync(CMD_TOOLS_BIN, ['-v'], { encoding: 'utf8' }).trim();
            return { installed: true, status: `Installed (${version})` };
        } catch {
            return { installed: true, status: 'Installed (version unknown)' };
        }
    } else {
        return { installed: false, status: 'Not installed' };
    }
}

const pipelineAsync = promisify(pipeline);

async function downloadFile(url: string, dest: string, progress?: vscode.Progress<{message?: string, increment?: number}>, abortSignal?: AbortSignal): Promise<void> {
    const proto = url.startsWith('https') ? https : http;
    return new Promise((resolve, reject) => {
        if (abortSignal?.aborted) {
            reject(new Error('Download cancelled'));
            return;
        }
        const file = fs.createWriteStream(dest);
        const req = proto.get(url, response => {
            if (response.statusCode !== 200) {
                oniroLogChannel.appendLine(`[SDK] Failed to get '${url}' (${response.statusCode})`);
                reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
                return;
            }
            const total = parseInt(response.headers['content-length'] || '0', 10);
            let downloaded = 0;
            let lastPercent = 0;
            response.on('data', chunk => {
                downloaded += chunk.length;
                if (progress && total) {
                    const percent = Math.min(100, Math.round((downloaded / total) * 100));
                    if (percent > lastPercent) {
                        progress.report({ message: `Downloading: ${percent}%`, increment: percent - lastPercent });
                        lastPercent = percent;
                    }
                }
            });
            response.pipe(file);
            file.on('finish', () => file.close((err) => err ? reject(err) : resolve()));
            // Cancel download if aborted
            abortSignal?.addEventListener('abort', () => {
                response.destroy();
                file.close();
                fs.unlink(dest, () => {});
                reject(new Error('Download cancelled'));
            });
        }).on('error', (err) => {
            oniroLogChannel.appendLine(`[SDK] Error downloading '${url}': ${err.message}`);
            reject(err);
        });
        abortSignal?.addEventListener('abort', () => {
            req.destroy();
            file.close();
            fs.unlink(dest, () => {});
            reject(new Error('Download cancelled'));
        });
    });
}

async function verifySha256(filePath: string, sha256Path: string): Promise<void> {
    const expected = fs.readFileSync(sha256Path, 'utf8').split(/\s+/)[0];
    const hash = crypto.createHash('sha256');
    const fileStream = fs.createReadStream(filePath);
    await pipelineAsync(fileStream, hash);
    const actual = hash.digest('hex');
    if (actual !== expected) {
        throw new Error(`SHA256 mismatch: expected ${expected}, got ${actual}`);
    }
}

async function extractTarball(tarPath: string, dest: string, strip: number): Promise<void> {
    await tar.x({ file: tarPath, cwd: dest, strip });
}

function getSdkFilename(): { filename: string, osFolder: string, strip: number } {
    const platform = os.platform();
    if (platform === 'linux') {
        return { filename: 'ohos-sdk-windows_linux-public.tar.gz', osFolder: 'linux', strip: 1 };
    } else if (platform === 'darwin') {
        if (os.arch() === 'arm64') {
            return { filename: 'L2-SDK-MAC-M1-PUBLIC.tar.gz', osFolder: 'darwin', strip: 3 };
        } else {
            return { filename: 'ohos-sdk-mac-public.tar.gz', osFolder: 'darwin', strip: 3 };
        }
    } else if (platform === 'win32') {
        return { filename: 'ohos-sdk-windows_linux-public.tar.gz', osFolder: 'windows', strip: 1 };
    } else {
        throw new Error('Unsupported OS');
    }
}

export async function downloadAndInstallSdk(version: string, api: string, progress?: vscode.Progress<{message?: string, increment?: number}>, abortSignal?: AbortSignal): Promise<void> {
    const { filename, osFolder, strip } = getSdkFilename();
    const urlBase = 'https://repo.huaweicloud.com/openharmony/os';
    const downloadUrl = `${urlBase}/${version}-Release/${filename}`;
    const sha256Url = `${downloadUrl}.sha256`;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oniro-sdk-'));
    const tarPath = path.join(tmpDir, filename);
    const sha256Path = path.join(tmpDir, filename + '.sha256');
    const extractDir = path.join(tmpDir, 'extract');
    fs.mkdirSync(extractDir);
    const sdkInstallDir = path.join(getSdkRootDir(), osFolder, api);
    fs.mkdirSync(path.dirname(sdkInstallDir), { recursive: true });
    try {
        if (progress) progress.report({ message: 'Downloading SDK archive...', increment: 0 });
        await downloadFile(downloadUrl, tarPath, progress, abortSignal);
        if (progress) progress.report({ message: 'Downloading checksum...', increment: 0 });
        await downloadFile(sha256Url, sha256Path, progress, abortSignal);
        if (progress) progress.report({ message: 'Verifying checksum...', increment: 0 });
        await verifySha256(tarPath, sha256Path);
        if (progress) progress.report({ message: 'Extracting SDK (this may take a while)...', increment: 0 });
        await extractTarball(tarPath, extractDir, strip);
        if (progress) progress.report({ message: 'Extracting SDK components (this may take a while)...', increment: 0 });
        // Unzip each component archive in the OS directory
        const osContentPath = path.join(extractDir, osFolder);
        const zipFiles = fs.readdirSync(osContentPath).filter(name => name.endsWith('.zip'));
        for (const zipFile of zipFiles) {
            oniroLogChannel.appendLine(`[SDK] Extracting component ${zipFile}`);
            const zipPath = path.join(osContentPath, zipFile);
            await extractZip(zipPath, { dir: osContentPath });
            fs.unlinkSync(zipPath);
        }
        if (progress) progress.report({ message: 'Finalizing installation...', increment: 0 });
        // Move the correct OS folder to sdkInstallDir
        const osPath = path.join(extractDir, osFolder);
        if (!fs.existsSync(osPath)) {
            throw new Error(`Expected folder '${osFolder}' not found in extracted SDK. Extraction may have failed or the archive structure is unexpected.`);
        }
        if (fs.existsSync(sdkInstallDir)) fs.rmSync(sdkInstallDir, { recursive: true, force: true });
        fs.renameSync(osPath, sdkInstallDir);
        if (progress) progress.report({ message: 'Cleaning up...', increment: 0 });
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
        oniroLogChannel.appendLine(`[SDK] ERROR: ${err instanceof Error ? err.message : String(err)}`);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw err;
    }
}

export async function installCmdTools(progress?: vscode.Progress<{message?: string, increment?: number}>, abortSignal?: AbortSignal): Promise<void> {
    // Based on cmd_tools_installer.sh logic
    const CMD_PATH = CMD_TOOLS_PATH;
    const url = 'https://repo.huaweicloud.com/harmonyos/ohpm/5.0.5/commandline-tools-linux-x64-5.0.5.310.zip';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oniro-cmdtools-'));
    const zipPath = path.join(tmpDir, 'oh-command-line-tools.zip');
    const extractPath = path.join(tmpDir, 'oh-command-line-tools');
    try {
        if (progress) progress.report({ message: 'Downloading command line tools...', increment: 0 });
        await downloadFile(url, zipPath, progress, abortSignal);
        if (progress) progress.report({ message: 'Extracting tools...', increment: 0 });
        await extractZip(zipPath, { dir: extractPath });
        // Move extracted files to CMD_PATH
        fs.mkdirSync(CMD_PATH, { recursive: true });
        const srcDir = path.join(extractPath, 'command-line-tools');
        for (const entry of fs.readdirSync(srcDir)) {
            const src = path.join(srcDir, entry);
            const dest = path.join(CMD_PATH, entry);
            if (fs.statSync(src).isDirectory()) {
                if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
                fs.renameSync(src, dest);
            } else {
                fs.copyFileSync(src, dest);
            }
        }
        // Make bin/* executable
        const binDir = path.join(CMD_PATH, 'bin');
        if (fs.existsSync(binDir)) {
            for (const file of fs.readdirSync(binDir)) {
                fs.chmodSync(path.join(binDir, file), 0o755);
            }
        }
        if (progress) progress.report({ message: 'Cleaning up...', increment: 0 });
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw err;
    }
}

export function removeCmdTools(): void {
    if (fs.existsSync(CMD_TOOLS_PATH)) {
        fs.rmSync(CMD_TOOLS_PATH, { recursive: true, force: true });
    }
}

export function registerSdkManagerCommand(context: vscode.ExtensionContext) {
    const openSdkManagerDisposable = vscode.commands.registerCommand(OniroCommands.OPEN_SDK_MANAGER, () => {
        const panel = vscode.window.createWebviewPanel(
            'oniroSdkManager',
            'Oniro SDK Manager',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        function updateWebview() {
            panel.webview.html = getSdkManagerHtml(
                context,
                getAvailableSdks(),
                getCmdToolsStatus()
            );
        }

        updateWebview();

        let currentAbortController: AbortController | undefined;

        panel.webview.onDidReceiveMessage(
            async message => {
                if (message.command === 'downloadSdk') {
                    if (currentAbortController) {
                        currentAbortController.abort();
                    }
                    currentAbortController = new AbortController();
                    try {
                        await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: `Downloading and installing SDK ${message.version} (API ${message.api})`,
                            cancellable: true
                        }, async (progress, token) => {
                            token.onCancellationRequested(() => {
                                currentAbortController?.abort();
                            });
                            await downloadAndInstallSdk(message.version, message.api, progress, currentAbortController?.signal);
                        });
                        updateWebview();
                        vscode.window.showInformationMessage(`SDK ${message.version} (API ${message.api}) installed.`);
                    } catch (err: any) {
                        if (err?.message === 'Download cancelled') {
                            vscode.window.showWarningMessage('SDK download cancelled.');
                        } else {
                            vscode.window.showErrorMessage(`Failed to install SDK: ${err.message}`);
                        }
                    } finally {
                        currentAbortController = undefined;
                    }
                } else if (message.command === 'removeSdk') {
                    try {
                        const sdkRoot = getSdkRootDir();
                        const { version, api } = message;
                        const osFolders = ['linux', 'darwin', 'windows'];
                        let removed = false;
                        for (const osFolder of osFolders) {
                            const sdkPath = path.join(sdkRoot, osFolder, api);
                            if (fs.existsSync(sdkPath)) {
                                fs.rmSync(sdkPath, { recursive: true, force: true });
                                removed = true;
                            }
                        }
                        updateWebview();
                        if (removed) {
                            vscode.window.showInformationMessage(`SDK ${version} (API ${api}) removed.`);
                        } else {
                            vscode.window.showWarningMessage(`SDK ${version} (API ${api}) not found.`);
                        }
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Failed to remove SDK: ${err.message}`);
                    }
                } else if (message.command === 'checkCmdTools') {
                    panel.webview.postMessage({
                        type: 'cmdToolsStatus',
                        ...getCmdToolsStatus()
                    });
                } else if (message.command === 'installCmdTools') {
                    if (currentAbortController) currentAbortController.abort();
                    currentAbortController = new AbortController();
                    try {
                        await vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: 'Installing OpenHarmony Command Line Tools',
                            cancellable: true
                        }, async (progress, token) => {
                            token.onCancellationRequested(() => {
                                currentAbortController?.abort();
                            });
                            await installCmdTools(progress, currentAbortController?.signal);
                        });
                        updateWebview();
                        vscode.window.showInformationMessage('Command line tools installed.');
                    } catch (err: any) {
                        if (err?.message === 'Download cancelled') {
                            vscode.window.showWarningMessage('Command line tools installation cancelled.');
                        } else {
                            vscode.window.showErrorMessage(`Failed to install command line tools: ${err.message}`);
                        }
                    } finally {
                        currentAbortController = undefined;
                    }
                } else if (message.command === 'removeCmdTools') {
                    try {
                        removeCmdTools();
                        updateWebview();
                        vscode.window.showInformationMessage('Command line tools removed.');
                    } catch (err: any) {
                        vscode.window.showErrorMessage(`Failed to remove command line tools: ${err.message}`);
                    }
                }
            },
            undefined,
            []
        );
    });
    context.subscriptions.push(openSdkManagerDisposable);
}
