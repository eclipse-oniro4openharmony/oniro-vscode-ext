import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { https, http } from 'follow-redirects';
import { pipeline } from 'stream';
import { promisify } from 'util';
import * as crypto from 'crypto';
import * as tar from 'tar';
import extractZip from 'extract-zip';
import { oniroLogChannel } from '../utils/logger';
import * as vscode from 'vscode';

export interface SdkInfo {
    version: string;
    api: string;
    installed: boolean;
}

// Get Oniro SDK root and command tools path from configuration, with fallback to defaults
function getOniroConfig<T = string>(key: string, fallback: T): T {
    const config = vscode.workspace.getConfiguration('oniro');
    let value = config.get<T>(key);
    if (typeof value === 'string' && value.includes('${userHome}')) {
        value = value.replace(/\$\{userHome\}/g, os.homedir()) as T;
    }
    return (value === undefined || value === null || value === "") ? fallback : value;
}

export function getSdkRootDir(): string {
    return getOniroConfig('sdkRootDir', path.join(os.homedir(), 'setup-ohos-sdk'));
}

export function getCmdToolsPath(): string {
    return getOniroConfig('cmdToolsPath', path.join(os.homedir(), 'command-line-tools'));
}

export function getCmdToolsBin(): string {
    return path.join(getCmdToolsPath(), 'bin', 'ohpm');
}

// Helper to get the full hdc executable path
export function getHdcPath(): string {
  // hdc is located in ./sdk/default/openharmony/toolchains/hdc relative to getCmdToolsPath()
  return path.join(getCmdToolsPath(), 'sdk', 'default', 'openharmony', 'toolchains', 'hdc');
}

export const ALL_SDKS = [
    { version: '4.0', api: '10' },
    { version: '4.1', api: '11' },
    { version: '5.0.0', api: '12' },
    { version: '5.0.1', api: '13' },
    { version: '5.0.2', api: '14' },
    { version: '5.0.3', api: '15' },
    { version: '5.1.0', api: '18' }
];

export function getInstalledSdks(): string[] {
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
    return ALL_SDKS.filter(sdk => versions.has(sdk.api)).map(sdk => sdk.version);
}


export function isCmdToolsInstalled(): boolean {
    return fs.existsSync(getCmdToolsBin());
}

export function getCmdToolsStatus(): { installed: boolean, status: string } {
    if (isCmdToolsInstalled()) {
        try {
            const version = require('child_process').execFileSync(getCmdToolsBin(), ['-v'], { encoding: 'utf8' }).trim();
            return { installed: true, status: `Installed (${version})` };
        } catch {
            return { installed: true, status: 'Installed (version unknown)' };
        }
    } else {
        return { installed: false, status: 'Not installed' };
    }
}

const pipelineAsync = promisify(pipeline);

export async function downloadFile(url: string, dest: string, progress?: vscode.Progress<{message?: string, increment?: number}>, abortSignal?: AbortSignal): Promise<void> {
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
                        // @ts-ignore
                        progress.report?.({ message: `Downloading: ${percent}%`, increment: percent - lastPercent });
                        lastPercent = percent;
                    }
                }
            });
            response.pipe(file);
            file.on('finish', () => file.close((err) => err ? reject(err) : resolve()));
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

export async function verifySha256(filePath: string, sha256Path: string): Promise<void> {
    const expected = fs.readFileSync(sha256Path, 'utf8').split(/\s+/)[0];
    const hash = crypto.createHash('sha256');
    const fileStream = fs.createReadStream(filePath);
    await pipelineAsync(fileStream, hash);
    const actual = hash.digest('hex');
    if (actual !== expected) {
        throw new Error(`SHA256 mismatch: expected ${expected}, got ${actual}`);
    }
}

export async function extractTarball(tarPath: string, dest: string, strip: number): Promise<void> {
    await tar.x({ file: tarPath, cwd: dest, strip });
}

export function getSdkFilename(): { filename: string, osFolder: string, strip: number } {
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
        if (progress) progress.report?.({ message: 'Downloading SDK archive...', increment: 0 });
        await downloadFile(downloadUrl, tarPath, progress, abortSignal);
        if (progress) progress.report?.({ message: 'Downloading checksum...', increment: 0 });
        await downloadFile(sha256Url, sha256Path, progress, abortSignal);
        if (progress) progress.report?.({ message: 'Verifying checksum...', increment: 0 });
        await verifySha256(tarPath, sha256Path);
        if (progress) progress.report?.({ message: 'Extracting SDK (this may take a while)...', increment: 0 });
        await extractTarball(tarPath, extractDir, strip);
        if (progress) progress.report?.({ message: 'Extracting SDK components (this may take a while)...', increment: 0 });
        const osContentPath = path.join(extractDir, osFolder);
        const zipFiles = fs.readdirSync(osContentPath).filter(name => name.endsWith('.zip'));
        for (const zipFile of zipFiles) {
            oniroLogChannel.appendLine(`[SDK] Extracting component ${zipFile}`);
            const zipPath = path.join(osContentPath, zipFile);
            await extractZip(zipPath, { dir: osContentPath });
            fs.unlinkSync(zipPath);
        }
        if (progress) progress.report?.({ message: 'Finalizing installation...', increment: 0 });
        const osPath = path.join(extractDir, osFolder);
        if (!fs.existsSync(osPath)) {
            throw new Error(`Expected folder '${osFolder}' not found in extracted SDK. Extraction may have failed or the archive structure is unexpected.`);
        }
        if (fs.existsSync(sdkInstallDir)) fs.rmSync(sdkInstallDir, { recursive: true, force: true });
        fs.renameSync(osPath, sdkInstallDir);
        if (progress) progress.report?.({ message: 'Cleaning up...', increment: 0 });
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
        oniroLogChannel.appendLine(`[SDK] ERROR: ${err instanceof Error ? err.message : String(err)}`);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw err;
    }
}

export async function installCmdTools(progress?: vscode.Progress<{message?: string, increment?: number}>, abortSignal?: AbortSignal): Promise<void> {
    const CMD_PATH = getCmdToolsPath();
    const url = 'https://repo.huaweicloud.com/harmonyos/ohpm/5.0.5/commandline-tools-linux-x64-5.0.5.310.zip';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oniro-cmdtools-'));
    const zipPath = path.join(tmpDir, 'oh-command-line-tools.zip');
    const extractPath = path.join(tmpDir, 'oh-command-line-tools');
    try {
        if (progress) progress.report?.({ message: 'Downloading command line tools...', increment: 0 });
        await downloadFile(url, zipPath, progress, abortSignal);
        if (progress) progress.report?.({ message: 'Extracting tools...', increment: 0 });
        await extractZip(zipPath, { dir: extractPath });
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
        const binDir = path.join(CMD_PATH, 'bin');
        if (fs.existsSync(binDir)) {
            for (const file of fs.readdirSync(binDir)) {
                fs.chmodSync(path.join(binDir, file), 0o755);
            }
        }
        if (progress) progress.report?.({ message: 'Cleaning up...', increment: 0 });
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw err;
    }
}

export function removeCmdTools(): void {
    if (fs.existsSync(getCmdToolsPath())) {
        fs.rmSync(getCmdToolsPath(), { recursive: true, force: true });
    }
}

/**
 * Removes the SDK for the given API version from all OS folders.
 * Returns true if any SDK was removed, false otherwise.
 */
export function removeSdk(api: string): boolean {
    const osFolders = ['linux', 'darwin', 'windows'];
    let removed = false;
    for (const osFolder of osFolders) {
        const sdkPath = path.join(getSdkRootDir(), osFolder, api);
        if (fs.existsSync(sdkPath)) {
            fs.rmSync(sdkPath, { recursive: true, force: true });
            removed = true;
        }
    }
    return removed;
}

// Get Oniro Emulator directory from configuration, with fallback to ~/oniro-emulator
export function getEmulatorDir(): string {
    return getOniroConfig('emulatorDir', path.join(os.homedir(), 'oniro-emulator'));
}

/**
 * Checks if the emulator is installed (by checking for run.sh in images/).
 */
export function isEmulatorInstalled(): boolean {
    const emulatorRunSh = path.join(getEmulatorDir(), 'images', 'run.sh');
    return fs.existsSync(emulatorRunSh);
}

/**
 * Installs the Oniro emulator by downloading and extracting it.
 */
export async function installEmulator(
    progress?: vscode.Progress<{message?: string, increment?: number}>,
    abortSignal?: AbortSignal
): Promise<void> {
    const EMULATOR_URL = "https://github.com/eclipse-oniro4openharmony/device_board_oniro/releases/download/v1.0.0/oniro_emulator.zip";
    const EMULATOR_DIR = getEmulatorDir();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oniro-emulator-'));
    const tmpZip = path.join(tmpDir, 'oniro_emulator.zip');
    try {
        fs.mkdirSync(EMULATOR_DIR, { recursive: true });
        if (progress) progress.report?.({ message: 'Downloading emulator...', increment: 0 });
        await downloadFile(EMULATOR_URL, tmpZip, progress, abortSignal);
        if (progress) progress.report?.({ message: 'Extracting emulator...', increment: 0 });
        await extractZip(tmpZip, { dir: EMULATOR_DIR });
        const runSh = path.join(EMULATOR_DIR, 'images', 'run.sh');
        if (fs.existsSync(runSh)) {
            fs.chmodSync(runSh, 0o755);
        }
        if (progress) progress.report?.({ message: 'Cleaning up...', increment: 0 });
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (err) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw err;
    }
}

/**
 * Removes the Oniro emulator directory.
 */
export function removeEmulator(): void {
    const EMULATOR_DIR = getEmulatorDir();
    if (fs.existsSync(EMULATOR_DIR)) {
        fs.rmSync(EMULATOR_DIR, { recursive: true, force: true });
    }
}
