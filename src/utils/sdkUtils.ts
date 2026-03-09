import * as fs from 'fs';
import * as path from 'path';
import * as JSON5 from 'json5';
import * as os from 'os';
import { https, http } from 'follow-redirects';
import { pipeline } from 'stream';
import { promisify } from 'util';
import * as crypto from 'crypto';
import * as tar from 'tar';
import { oniroLogChannel } from '../utils/logger';
import * as vscode from 'vscode';

const pipelineAsync = promisify(pipeline);

/**
 * Extracts a ZIP archive to a destination directory, reporting progress and restoring file permissions.
 *
 * This function uses the `node-stream-zip` library to extract files from a ZIP archive. It reports extraction progress
 * via the provided VS Code progress object. For each extracted file, it restores the original file permissions
 * (if available in the ZIP attributes), which is important for executable files on Linux/macOS.
 *
 * @param zipPath The path to the ZIP archive to extract.
 * @param dest The destination directory where files will be extracted.
 * @param progress (Optional) VS Code progress object for reporting extraction progress.
 * @param start (Optional) Overall progress start offset (0..100). Default: 0.
 * @param range (Optional) Overall progress range to consume (0..100). Default: 100.
 * @returns A Promise that resolves when extraction is complete.
 */
async function extractZipWithProgress(
    zipPath: string,
    dest: string,
    progress?: vscode.Progress<{message?: string, increment?: number}>,
    start: number = 0,
    range: number = 100
): Promise<void> {

    // Lazy require to avoid import-time errors if module is not installed
    const StreamZip = require('node-stream-zip');

    // Open the ZIP file and get the list of entries
    const zip = new StreamZip.async({ file: zipPath });
    const entries = await zip.entries();
    const files = Object.values(entries) as any[];
    const total = files.length || 1;

    // Clamp progress budget to sane bounds
    const s = Math.max(0, Math.min(100, start));
    const r = Math.max(0, Math.min(100 - s, range));

    let processed = 0;
    let lastOverall = Math.round(s);

    // Ensure the destination directory exists
    await fs.promises.mkdir(dest, { recursive: true });

    const destRoot = path.resolve(dest);

    // Prevent Zip Slip (path traversal) by ensuring every extracted path stays within destRoot
    const safeResolveTarget = (entryName: string): string => {
        const resolved = path.resolve(destRoot, entryName);
        const rel = path.relative(destRoot, resolved);

        // rel can be '' (root) or a normal relative path; reject anything escaping destRoot
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            throw new Error(`Blocked ZIP entry with illegal path: ${entryName}`);
        }

        return resolved;
    };
    
    try {
        // Process each file entry in the ZIP
        for (const file of files) {
            const entryName = file.name as string;
            const targetPath = safeResolveTarget(entryName);
            
            const attr = file.attr ? (file.attr >>> 16) : 0;
            const isSymlink = Object.prototype.hasOwnProperty.call(file, 'isSymbolicLink') 
                ? file.isSymbolicLink 
                : ((attr & 0o170000) === 0o120000);

            if (file.isDirectory) {
                // Create directory if the entry is a directory
                await fs.promises.mkdir(targetPath, { recursive: true });
            } else if (isSymlink) {
                // Ensure the parent directory exists
                await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
                
                // The content of the symlink file is the target path
                const linkTargetBuffer = await zip.entryData(file);
                const linkTarget = linkTargetBuffer.toString('utf8');
                
                try {
                    // Determine symlink type for Windows (optional but recommended depending on target)
                    const isWin = os.platform() === 'win32';
                    // Node's default is 'file', but if it points to a directory you might need 'junction' on Windows
                    // We'll just use 'file' or undefined for now.
                    await fs.promises.symlink(linkTarget, targetPath, isWin ? 'file' : undefined);
                } catch (e) {
                    oniroLogChannel.appendLine(`[SDK] Failed to create symlink at ${targetPath}: ${e}`);
                }
            } else {

                // Ensure the parent directory exists
                await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
                
                // Extract the file by streaming its contents to disk
                const readStream = await zip.stream(file);
                const writeStream = fs.createWriteStream(targetPath);
                await pipelineAsync(readStream as any, writeStream);

                // Restore file permissions if available in ZIP attributes (important for executables)
                // Only applies to files, not directories
                if (attr > 0) {
                    try {
                        await fs.promises.chmod(targetPath, attr & 0o777);
                    } catch (e) {
                        // Ignore chmod errors (e.g., on Windows or if not supported)
                    }
                }
            }

            processed++;

            // Report extraction progress if a progress object is provided
            if (progress) {

                const localPercent = Math.min(100, Math.round((processed / total) * 100));
                const overall = Math.min(100, Math.round(s + (processed / total) * r));
                const inc = overall - lastOverall;

                if (inc > 0) {
                    progress.report?.({ message: `Extracting: ${localPercent}%`, increment: inc });
                    lastOverall = overall;
                } else {
                    progress.report?.({ message: `Extracting: ${localPercent}%`, increment: 0 });
                }
            }
        } // end of for-loop
    } finally {
        await zip.close();
    }

    // Ensure we finish exactly at the end of our allocated range.
    if (progress) {
        const endOverall = Math.min(100, Math.round(s + r));
        const inc = endOverall - lastOverall;
        if (inc > 0) { progress.report?.({ message: `Extracting: 100%`, increment: inc }); }
    }
}

/**
 * Prompt the user to select a ZIP archive and install command line tools from it.
 *
 * This fallback installer is used when no automatic download URL is configured
 * for the current platform. It asks the user to pick a ZIP file, extracts its
 * contents to a temporary directory, locates the command-line tools subfolder
 * and moves its files into the configured command tools path.
 *
 * @param progress Optional VS Code progress reporter to show extraction/install progress.
 * @param abortSignal Optional AbortSignal to cancel the installation.
 * @returns A promise that resolves when installation completes.
 * @throws Error If the user does not select a ZIP file or if extraction/installation fails.
 */
export async function manualInstallCmdTools(progress?: vscode.Progress<{message?: string, increment?: number}>, abortSignal?: AbortSignal): Promise<void> {

    // Prompt for ZIP file
    vscode.window.showInformationMessage('No download URL is configured for command line tools on this OS. Please download the ZIP manually and select it for installation.');
    const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: 'Select ZIP file',
        filters: { 'ZIP files': ['zip'] }
    });

    if (!uris || uris.length === 0) {
        throw new Error('No ZIP file selected.');
    }

    const zipPath = uris[0].fsPath;

    // Internal worker to perform extraction and installation using provided progress
    const doInstall = async (p?: vscode.Progress<{message?: string, increment?: number}>, signal?: AbortSignal) => {

        const CMD_PATH = getCmdToolsPath();
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oniro-cmdtools-'));
        const extractPath = path.join(tmpDir, 'oh-command-line-tools');

        try {

            if (p) { p.report?.({ message: 'Extracting tools...', increment: 0 }); }
            
            await extractZipWithProgress(zipPath, extractPath, p);
            
            if (signal?.aborted) { throw new Error('Download cancelled'); }
            
            fs.mkdirSync(CMD_PATH, { recursive: true });
            const srcDir = findCmdToolsSourceDir(extractPath);
            
            for (const entry of fs.readdirSync(srcDir)) {
                if (signal?.aborted) { throw new Error('Download cancelled'); }
                const src = path.join(srcDir, entry);
                const dest = path.join(CMD_PATH, entry);
                if (fs.statSync(src).isDirectory()) {
                    if (fs.existsSync(dest)) { fs.rmSync(dest, { recursive: true, force: true }); }
                    fs.renameSync(src, dest);
                } else {
                    fs.copyFileSync(src, dest);
                }
            }

            const binDir = path.join(CMD_PATH, 'bin');
            if (fs.existsSync(binDir) && os.platform() !== 'win32') {
                for (const file of fs.readdirSync(binDir)) {
                    fs.chmodSync(path.join(binDir, file), 0o755);
                }
            }
            
            if (p) { p.report?.({ message: 'Cleaning up...', increment: 0 }); }
            
            fs.rmSync(tmpDir, { recursive: true, force: true });
        
        } catch (err) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            throw err;
        }
    };

    // If caller provided a progress object (e.g. sdkManager.withProgress), use it.
    if (progress) {
        await doInstall(progress, abortSignal);
        return;
    }

    // Otherwise show our own progress notification so user sees extraction progress.
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Installing OpenHarmony Command Line Tools',
        cancellable: true
    }, async (p, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());  
        await doInstall(p, controller.signal);
    });

    // After successful manual install show information and try to open/refresh SDK Manager
    vscode.window.showInformationMessage(`Command line tools installed to: ${getCmdToolsPath()}`);

    // Try to open SDK Manager so the UI reflects the new installation; if already open, this will focus it.
    try { await vscode.commands.executeCommand('oniro-ide.openSdkManager'); } catch (_) {}
}

export interface SdkInfo {
    version: string;
    api: string;
    installed: boolean;
}

/**
 * Get SDK metadata for display in the UI.
 *
 * Returns a list of known SDK entries annotated with whether they are
 * installed for the current OS. The list is sorted by API level descending.
 *
 * @returns An array of `SdkInfo` objects containing `version`, `api` and
 *   `installed` boolean fields.
 */
export function getSupportedSdksForUi(): SdkInfo[] {
    const base = getOhosBaseSdkHome();
    return ALL_SDKS
        .map((sdk) => {
            const sdkDir = path.join(base, String(sdk.api));
            return { version: sdk.version, api: sdk.api, installed: fs.existsSync(sdkDir) };
        })
        .sort((a, b) => Number(b.api) - Number(a.api));
}

/**
 * Read an extension configuration value with a fallback.
 *
 * This helper reads the `oniro` configuration section from the workspace
 * settings and returns the configured value or the provided fallback. If the
 * configuration value is a string containing the `${userHome}` pattern it
 * will be expanded to the current user's home directory.
 *
 * @param key The configuration key under the `oniro` section.
 * @param fallback The fallback value to use when configuration is not set.
 * @returns The configuration value (type `T`) or the fallback.
 */
function getOniroConfig<T = string>(key: string, fallback: T): T {
    const config = vscode.workspace.getConfiguration('oniro');
    let value = config.get<T>(key);

    if (typeof value === 'string' && value.includes('${userHome}')) {
        value = value.replace(/\$\{userHome\}/g, os.homedir()) as T;
    }

    return (value === undefined || value === null || value === "") ? fallback : value;
}

// Determine OS folder for SDK path
/**
 * Determine the OS-specific folder name used in the SDK layout.
 *
 * Maps Node's `os.platform()` values to the folder names used by the
 * extension for SDK storage: `linux`, `darwin`, or `windows`.
 *
 * @returns A folder name string for the current platform.
 * @throws Error If the running platform is not supported.
 */
function getOsFolder(): string {
  const platform = os.platform();
    if (platform === 'linux') { return 'linux'; }
    if (platform === 'darwin') { return 'darwin'; }
    if (platform === 'win32') { return 'windows'; }
  throw new Error('Unsupported OS');
}

/**
 * Return the root directory where SDKs are installed.
 *
 * Reads the `oniro.sdkRootDir` setting, falling back to
 * `~/setup-ohos-sdk` when unset.
 *
 * @returns Absolute path to the SDK root directory.
 */
export function getSdkRootDir(): string {
    return getOniroConfig('sdkRootDir', path.join(os.homedir(), 'setup-ohos-sdk'));
}

/**
 * Return the base SDK home for the current OS.
 *
 * Combines the SDK root directory with the platform-specific folder
 * (e.g. `linux`, `darwin`, `windows`).
 *
 * @returns Absolute path to the OS-specific SDK folder.
 */
export function getOhosBaseSdkHome(): string {
    return path.join(getSdkRootDir(), getOsFolder());
}

/**
 * Return the configured path for command-line tools.
 *
 * Reads `oniro.cmdToolsPath` and falls back to `~/command-line-tools`.
 *
 * @returns Absolute path to the command-line tools installation directory.
 */
export function getCmdToolsPath(): string {
    return getOniroConfig('cmdToolsPath', path.join(os.homedir(), 'command-line-tools'));
}

/**
 * Return the first path from `candidates` that exists on disk.
 *
 * If none of the candidate paths exist, the first candidate is returned
 * unchanged. This is a convenience used to select among platform-specific
 * executable names.
 *
 * @param candidates Array of absolute or relative file paths to test.
 * @returns The first existing path, or `candidates[0]` if none exist.
 */
function getExistingFilePath(candidates: string[]): string {
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) { return candidate; }
    }

    return candidates[0];
}

/**
 * Return the path to the `ohpm` binary inside the command tools `bin` folder.
 *
 * On Windows several filename variants are tried and the first that exists
 * is returned. On POSIX platforms the canonical `ohpm` name is returned.
 *
 * @returns Absolute path to the command tools executable.
 */
export function getCmdToolsBin(): string {
    const binDir = path.join(getCmdToolsPath(), 'bin');
    const platform = os.platform();

    if (platform === 'win32') {
        return getExistingFilePath([
            path.join(binDir, 'ohpm.exe'),
            path.join(binDir, 'ohpm.cmd'),
            path.join(binDir, 'ohpm.bat'),
            path.join(binDir, 'ohpm')
        ]);
    }

    return path.join(binDir, 'ohpm');
}

/**
 * Return the full path to the `hdc` executable inside the command tools tree.
 *
 * Tries common Windows variants (`.exe`, `.bat`, `.cmd`) when running on
 * Windows, otherwise returns the expected Unix-style path.
 *
 * @returns Absolute path to the `hdc` executable.
 */
export function getHdcPath(): string {

    // hdc is located in ./sdk/default/openharmony/toolchains/hdc relative to getCmdToolsPath()
    const base = path.join(getCmdToolsPath(), 'sdk', 'default', 'openharmony', 'toolchains');

    if (os.platform() === 'win32') {
        return getExistingFilePath([
            path.join(base, 'hdc.exe'),
            path.join(base, 'hdc.bat'),
            path.join(base, 'hdc.cmd'),
            path.join(base, 'hdc')
        ]);
    }

    return path.join(base, 'hdc');
}

export const ALL_SDKS = [
    { version: '4.0', api: '10' },
    { version: '4.1', api: '11' },
    { version: '5.0.0', api: '12' },
    { version: '5.0.1', api: '13' },
    { version: '5.0.2', api: '14' },
    { version: '5.0.3', api: '15' },
    { version: '5.1.0', api: '18' },
    { version: '6.0', api: '20' }
];

/**
 * Enumerate installed SDK API versions.
 *
 * Scans the SDK root directory for `linux`, `darwin` and `windows` folders,
 * collects API folder names and returns the set of installed SDK versions
 * matching the known `ALL_SDKS` mapping.
 *
 * @returns Array of SDK version strings (e.g. `['5.1.0']`) that are installed.
 */
export function getInstalledSdks(): string[] {
    const sdkRoot = getSdkRootDir();
    const versions = new Set<string>();

    if (!fs.existsSync(sdkRoot)) { return []; }

    for (const osFolder of ['linux', 'darwin', 'windows']) {
        const osPath = path.join(sdkRoot, osFolder);

        if (!fs.existsSync(osPath) || !fs.statSync(osPath).isDirectory()) { continue; }

        for (const api of fs.readdirSync(osPath)) {
            const apiPath = path.join(osPath, api);
            if (!fs.statSync(apiPath).isDirectory()) { continue; }
            versions.add(api);
        }
    }

    return ALL_SDKS.filter(sdk => versions.has(sdk.api)).map(sdk => sdk.version);
}

/**
 * Check whether the command-line tools are installed.
 *
 * @returns `true` if the expected command tools binary exists, otherwise `false`.
 */
export function isCmdToolsInstalled(): boolean {
    return fs.existsSync(getCmdToolsBin());
}

/**
 * Get a human-readable status for the command-line tools.
 *
 * If the tools are present this function attempts to read a `version.txt`
 * file or execute the binary with `-v` to obtain a version string. Falls
 * back to a generic "Installed (version unknown)" message when that fails.
 *
 * @returns An object with `{ installed: boolean, status: string }`.
 */
export function getCmdToolsStatus(): { installed: boolean, status: string } {
    
    if (isCmdToolsInstalled()) {
        
        // Prefer reading explicit version.txt '# Version: x.y.z' if present
        try {
            const versionFile = path.join(getCmdToolsPath(), 'version.txt');
            
            if (fs.existsSync(versionFile)) {
                const content = fs.readFileSync(versionFile, 'utf8');
                const lines = content.split(/\r?\n/);
                
                for (const line of lines) {
                    const m = line.match(/^\s*#\s*Version:\s*(.+)$/);
                    
                    if (m && m[1]) {
                        const ver = m[1].trim();
                        return { installed: true, status: `Installed (${ver})` };
                    }
                }
            }
        } catch (e) {
            // ignore and continue to try executing the binary
        }

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

/**
 * Download a remote file to a local destination with optional progress reporting.
 *
 * The function supports HTTP and HTTPS and follows redirects via the
 * `follow-redirects` library. If `progress` is provided and the server
 * supplies a `content-length` header, periodic progress reports will be
 * emitted. The operation can be cancelled by passing an `AbortSignal`.
 *
 * @param url The HTTP(S) URL to download.
 * @param dest Local filesystem path where the downloaded file will be written.
 * @param progress Optional VS Code progress reporter used to display % progress.
 * @param abortSignal Optional AbortSignal to cancel the download.
 * @param start (Optional) Overall progress start offset (0..100). Default: 0.
+  @param range (Optional) Overall progress range to consume (0..100). Default: 100.
 * @returns A promise that resolves when the file is fully written.
 * @throws Error If the server responds with a non-200 status or if the
 *         download is cancelled or fails.
 */
export async function downloadFile(
    url: string,
    dest: string,
    progress?: vscode.Progress<{message?: string, increment?: number}>,
    abortSignal?: AbortSignal,
    start: number = 0,
    range: number = 100
): Promise<void> {

    const proto = url.startsWith('https') ? https : http;
    
    return new Promise((resolve, reject) => {
       
        // Clamp progress budget to sane bounds
        const s = Math.max(0, Math.min(100, start));
        const r = Math.max(0, Math.min(100 - s, range));

        let settled = false;
        const done = (err?: any) => {
            if (settled) { return; }
            settled = true;
            err ? reject(err) : resolve();
        };

        if (abortSignal?.aborted) {
            done(new Error('Download cancelled'));
            return;
        }

        const file = fs.createWriteStream(dest);
        const req = proto.get(url, response => {
            
            if (response.statusCode !== 200) {
                oniroLogChannel.appendLine(`[SDK] Failed to get '${url}' (${response.statusCode})`);
                
                // Cleanup partially-created file
                try { response.destroy(); } catch {}
                try { file.close(); } catch {}
                fs.unlink(dest, () => {});                
                
                done(new Error(`Failed to get '${url}' (${response.statusCode})`));
                return;
            }

            const total = parseInt(response.headers['content-length'] || '0', 10);
            let downloaded = 0;
            let lastOverall = Math.round(s);

            response.on('data', chunk => {

                downloaded += chunk.length;

                if (progress && total) {

                    const localPercent = Math.min(100, Math.round((downloaded / total) * 100));
                    const overall = Math.min(100, Math.round(s + (downloaded / total) * r));
                    const inc = overall - lastOverall;

                    if (inc > 0) {
                        progress.report?.({ message: `Downloading: ${localPercent}%`, increment: inc });
                        lastOverall = overall;
                    } else {
                        progress.report?.({ message: `Downloading: ${localPercent}%`, increment: 0 });
                    }
                }
            });

            response.pipe(file);

            file.on('finish', () => {
                // Ensure we finish exactly at the end of our allocated range.
                if (progress) {
                    const endOverall = Math.min(100, Math.round(s + r));
                    const inc = endOverall - lastOverall;
                    if (inc > 0) { progress.report?.({ message: `Downloading: 100%`, increment: inc }); }
                }
                file.close((err) => err ? done(err) : done());
            });
            
            abortSignal?.addEventListener('abort', () => {
                response.destroy();
                file.close();
                fs.unlink(dest, () => {});
                done(new Error('Download cancelled'));
            });

        }).on('error', (err) => {
            oniroLogChannel.appendLine(`[SDK] Error downloading '${url}': ${err.message}`);
            try { file.close(); } catch {}
            fs.unlink(dest, () => {});
            done(err);
        });

        abortSignal?.addEventListener('abort', () => {
            req.destroy();
            file.close();
            fs.unlink(dest, () => {});
            done(new Error('Download cancelled'));
        });
    });
}

/**
 * Verify the SHA-256 checksum of a file against an on-disk .sha256 file.
 *
 * The `.sha256` file is expected to contain the hex checksum followed by
 * optional whitespace and filename. Only the first token is used as the
 * expected checksum. If the computed checksum does not match an Error is
 * thrown.
 *
 * @param filePath Path to the file to verify.
 * @param sha256Path Path to the .sha256 file containing the expected digest.
 * @returns A promise that resolves if the checksum matches.
 * @throws Error When the checksum does not match or reading fails.
 */
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

/**
 * Extract a tar.gz archive to a destination directory.
 *
 * Wrapper around `tar.x` that extracts the provided archive into `dest` and
 * applies the `strip` option to remove leading path components.
 *
 * @param tarPath Path to the tar.gz archive file.
 * @param dest Destination directory where contents will be extracted.
 * @param strip Number of leading path components to strip from archived paths.
 * @returns A promise that resolves when extraction is complete.
 */
export async function extractTarball(tarPath: string, dest: string, strip: number): Promise<void> {
    await tar.x({ file: tarPath, cwd: dest, strip });
}

/**
 * Determine the SDK archive filename and extraction options for the current OS.
 *
 * Given an optional SDK `version` this helper returns the expected remote
 * filename, the OS folder name contained in the archive and the number of
 * leading path components that must be stripped when extracting.
 *
 * @param version Optional SDK version string; when omitted the latest known
 *        version from `ALL_SDKS` is used.
 * @returns Object with `{ filename, osFolder, strip }` describing the archive.
 * @throws Error When the current platform is not supported.
 */
export function getSdkFilename(version?: string): { filename: string, osFolder: string, strip: number } {
    const platform = os.platform();
    
    // Default to latest if version not provided
    const v = version || ALL_SDKS[ALL_SDKS.length - 1].version;
    
    if (platform === 'linux') {
       
        // For 5.0.0 and 5.0.1, do not strip components
        const strip = (v === '5.0.0' || v === '5.0.1' || v === '6.0') ? 0 : 1;
        return { filename: 'ohos-sdk-windows_linux-public.tar.gz', osFolder: 'linux', strip };

    } else if (platform === 'darwin') {
        
        // Always strip 3 for mac
        if (os.arch() === 'arm64') {
            return { filename: 'L2-SDK-MAC-M1-PUBLIC.tar.gz', osFolder: 'darwin', strip: 3 };
        } else {
            return { filename: 'ohos-sdk-mac-public.tar.gz', osFolder: 'darwin', strip: 3 };
        }

    } else if (platform === 'win32') {
       
        // For 5.0.0 and 5.0.1, do not strip components
        const strip = (v === '5.0.0' || v === '5.0.1' || v === '6.0') ? 0 : 1;
        return { filename: 'ohos-sdk-windows_linux-public.tar.gz', osFolder: 'windows', strip };
        
    } else {
        throw new Error('Unsupported OS');
    }
}

/**
 * Download an SDK archive, verify it and install it under the SDK root.
 *
 * This workflow downloads the SDK tarball and its `.sha256` checksum file,
 * verifies the archive integrity, extracts its contents and moves the
 * platform-specific subfolder into the extension's SDK root directory.
 * Progress is reported via the optional `progress` reporter and the
 * operation can be cancelled with an `AbortSignal`.
 *
 * @param version SDK version to install (e.g. `5.1.0`).
 * @param api API level string corresponding to the SDK (e.g. `18`).
 * @param progress Optional VS Code progress reporter.
 * @param abortSignal Optional AbortSignal to cancel the installation.
 * @returns A promise that resolves when installation completes.
 * @throws Error If download, verification, extraction or installation fails.
 */
export async function downloadAndInstallSdk(
    version: string,
    api: string,
    progress?: vscode.Progress<{message?: string, increment?: number}>,
    abortSignal?: AbortSignal
): Promise<void> {

    const { filename, osFolder, strip } = getSdkFilename(version);
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
        // Progress budget (overall 0..100)
        // 0-35  : SDK archive download
        // 35-45 : checksum download
        // 45-50 : verify
        // 50-60 : extract tarball
        // 60-95 : extract component ZIPs
        // 95-100: finalize + cleanup

        if (progress) { progress.report?.({ message: 'Downloading SDK archive...', increment: 0 }); }
        await downloadFile(downloadUrl, tarPath, progress, abortSignal, 0, 35);

        if (progress) { progress.report?.({ message: 'Downloading checksum...', increment: 0 }); }
        await downloadFile(sha256Url, sha256Path, progress, abortSignal, 35, 10);

        if (progress) { progress.report?.({ message: 'Verifying checksum...', increment: 0 }); }
        await verifySha256(tarPath, sha256Path);
        if (progress) { progress.report?.({ message: 'Verifying checksum...', increment: 5 }); } // 45 -> 50

        if (abortSignal?.aborted) { throw new Error('Download cancelled'); }

        if (progress) { progress.report?.({ message: 'Extracting SDK (this may take a while)...', increment: 0 }); }
        await extractTarball(tarPath, extractDir, strip);
        if (progress) { progress.report?.({ message: 'Extracting SDK (this may take a while)...', increment: 10 }); } // 50 -> 60

        if (abortSignal?.aborted) { throw new Error('Download cancelled'); }

        const osContentPath = path.join(extractDir, osFolder);
        const zipFiles = fs.readdirSync(osContentPath).filter(name => name.endsWith('.zip'));

        // Allocate 60..95 across all component ZIPs
        const componentsStart = 60;
        const componentsBudget = 35;
        const n = zipFiles.length;

        if (progress && n === 0) {
            progress.report?.({ message: 'No SDK component ZIPs found.', increment: componentsBudget }); // 60 -> 95
        } else if (progress) {
            progress.report?.({ message: 'Extracting SDK components (this may take a while)...', increment: 0 });
        }

        const base = n > 0 ? Math.floor(componentsBudget / n) : 0;
        let rem = n > 0 ? (componentsBudget % n) : 0;
        let cursor = componentsStart;

        for (const zipFile of zipFiles) {
            if (abortSignal?.aborted) { throw new Error('Download cancelled'); }

            oniroLogChannel.appendLine(`[SDK] Extracting component ${zipFile}`);
            const zipPath = path.join(osContentPath, zipFile);

            const thisBudget = base + (rem > 0 ? 1 : 0);
            if (rem > 0) { rem--; }

            await extractZipWithProgress(zipPath, osContentPath, progress, cursor, thisBudget);
            cursor += thisBudget;

            fs.unlinkSync(zipPath);
        }

        if (progress) { progress.report?.({ message: 'Finalizing installation...', increment: 0 }); }

        const osPath = path.join(extractDir, osFolder);
        if (!fs.existsSync(osPath)) {
            throw new Error(
                `Expected folder '${osFolder}' not found in extracted SDK. Extraction may have failed or the archive structure is unexpected.`
            );
        }

        if (fs.existsSync(sdkInstallDir)) { fs.rmSync(sdkInstallDir, { recursive: true, force: true }); }
        fs.renameSync(osPath, sdkInstallDir);

        if (progress) { progress.report?.({ message: 'Finalizing installation...', increment: 3 }); } // 95 -> 98

        if (progress) { progress.report?.({ message: 'Cleaning up...', increment: 0 }); }
        fs.rmSync(tmpDir, { recursive: true, force: true });

        if (progress) { progress.report?.({ message: 'Cleaning up...', increment: 2 }); } // 98 -> 100

    } catch (err) {
        oniroLogChannel.appendLine(`[SDK] ERROR: ${err instanceof Error ? err.message : String(err)}`);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw err;
    }
}

/**
 * Compute the download URL for the command-line tools for the current OS.
 *
 * The function reads the `oniro` configuration for optional overrides and
 * returns a sensible default for Linux. On Windows and macOS it throws an
 * error when no configuration value is set because defaults are not provided.
 *
 * @returns A fully-qualified URL string where the command-line tools can be downloaded.
 * @throws Error When no download URL is configured for the current platform.
 */
function getCmdToolsDownloadUrl(): string {
    const config = vscode.workspace.getConfiguration('oniro');
    const platform = os.platform();

    if (platform === 'linux') {
        return config.get<string>('cmdToolsUrlLinux')
            || 'https://repo.huaweicloud.com/harmonyos/ohpm/5.1.0/commandline-tools-linux-x64-5.1.0.840.zip';
    }

    if (platform === 'win32') {
        const url = config.get<string>('cmdToolsUrlWindows');
        if (url) { return url; }
        throw new Error('Command line tools URL for Windows is not configured. Set oniro.cmdToolsUrlWindows.');
    }

    if (platform === 'darwin') {
        const url = config.get<string>('cmdToolsUrlMac');
        if (url) { return url; }
        throw new Error('Command line tools URL for macOS is not configured. Set oniro.cmdToolsUrlMac.');
    }

    throw new Error('Unsupported OS for command line tools.');
}

/**
 * Locate the extracted command-line tools source directory inside a temp path.
 *
 * The function checks known candidate subfolders and falls back to scanning
 * the top-level directories for one that contains a `bin` subfolder. If no
 * suitable folder is found an Error is thrown.
 *
 * @param extractPath Path to the directory where the archive was extracted.
 * @returns Absolute path to the directory that contains the command-line tools.
 * @throws Error If the tools directory cannot be located.
 */
function findCmdToolsSourceDir(extractPath: string): string {
    const known = [
        path.join(extractPath, 'command-line-tools'),
        path.join(extractPath, 'oh-command-line-tools'),
        path.join(extractPath, 'commandline-tools')
    ];

    for (const candidate of known) {
        if (fs.existsSync(candidate)) { return candidate; }
    }

    const entries = fs.readdirSync(extractPath, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => path.join(extractPath, e.name));

    for (const dir of entries) {
        if (fs.existsSync(path.join(dir, 'bin'))) { return dir; }
    }

    throw new Error('Could not locate command line tools folder in the extracted archive.');
}

/**
 * Download and install the command-line tools for the current platform.
 *
 * This function will attempt to obtain a download URL from configuration and
 * download the official archive. If no URL is configured for the OS, it
 * falls back to prompting the user to manually select a previously-downloaded
 * ZIP file (`manualInstallCmdTools`). Progress reporting and cancellation
 * are supported via the optional parameters.
 *
 * @param progress Optional VS Code progress reporter used to display progress.
 * @param abortSignal Optional AbortSignal to cancel the installation.
 * @returns A promise that resolves when installation is complete.
 * @throws Error When download, extraction or installation fails.
 */
export async function installCmdTools(
    progress?: vscode.Progress<{message?: string, increment?: number}>,
    abortSignal?: AbortSignal
): Promise<void> {
    
    const CMD_PATH = getCmdToolsPath();
    let url: string | undefined;

    try {
        url = getCmdToolsDownloadUrl();
    } catch (e) {
        // No URL configured for this OS, fall back to manual install
        await manualInstallCmdTools(progress, abortSignal);
        return;
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oniro-cmdtools-'));
    const zipPath = path.join(tmpDir, 'oh-command-line-tools.zip');
    const extractPath = path.join(tmpDir, 'oh-command-line-tools');

    try {

        if (progress) { progress.report?.({ message: 'Downloading command line tools...', increment: 0 }); }
        await downloadFile(url, zipPath, progress, abortSignal, 0, 50);
        
        if (progress) { progress.report?.({ message: 'Extracting tools...', increment: 0 }); }
        await extractZipWithProgress(zipPath, extractPath, progress, 50, 45);
        
        fs.mkdirSync(CMD_PATH, { recursive: true });
        const srcDir = findCmdToolsSourceDir(extractPath);

        for (const entry of fs.readdirSync(srcDir)) {
            const src = path.join(srcDir, entry);
            const dest = path.join(CMD_PATH, entry);

            if (fs.statSync(src).isDirectory()) {
                if (fs.existsSync(dest)) { fs.rmSync(dest, { recursive: true, force: true }); }
                fs.renameSync(src, dest);
            } else {
                fs.copyFileSync(src, dest);
            }
        }

        const binDir = path.join(CMD_PATH, 'bin');

        if (fs.existsSync(binDir) && os.platform() !== 'win32') {
            for (const file of fs.readdirSync(binDir)) {
                fs.chmodSync(path.join(binDir, file), 0o755);
            }
        }

        if (progress) { progress.report?.({ message: 'Finalizing installation...', increment: 5 }); } // 95 -> 100

        if (progress) { progress.report?.({ message: 'Cleaning up...', increment: 0 }); }     
        fs.rmSync(tmpDir, { recursive: true, force: true });

    } catch (err) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw err;
    }
}

/**
 * Remove the installed command-line tools directory, if present.
 *
 * This performs a recursive deletion of the configured `cmdToolsPath` and
 * is intended for use from the SDK manager UI when the user requests removal.
 */
export function removeCmdTools(): void {
    if (fs.existsSync(getCmdToolsPath())) {
        fs.rmSync(getCmdToolsPath(), { recursive: true, force: true });
    }
}

/**
 * Remove an installed SDK for a given API level across all OS folders.
 *
 * Iterates over the `linux`, `darwin` and `windows` SDK folders and deletes
 * any matching API folder. Returns `true` when at least one folder was
 * removed, otherwise `false`.
 *
 * @param api API level string (folder name) to remove, e.g. `18`.
 * @returns `true` if any SDK folder was deleted, `false` otherwise.
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

/**
 * Get the configured Oniro emulator installation directory.
 *
 * Reads `oniro.emulatorDir` and falls back to `~/oniro-emulator` if unset.
 *
 * @returns Absolute path to the emulator directory.
 */
export function getEmulatorDir(): string {
    return getOniroConfig('emulatorDir', path.join(os.homedir(), 'oniro-emulator'));
}

/**
 * Check whether the Oniro emulator appears to be installed.
 *
 * This performs a simple heuristic check by looking for the `images/run.sh`
 * script inside the configured emulator directory. On Windows the presence of
 * this script may not apply but the function still returns a boolean based on
 * filesystem presence.
 *
 * @returns `true` when the emulator run script exists, otherwise `false`.
 */
export function isEmulatorInstalled(): boolean {
    const emulatorRunSh = path.join(getEmulatorDir(), 'images', 'run.sh');
    return fs.existsSync(emulatorRunSh);
}


/**
 * Download and install the Oniro emulator archive to the configured folder.
 *
 * Downloads the emulator zip, extracts it to the emulator directory and
 * ensures the `run.sh` script is executable on POSIX systems. Supports an
 * optional progress reporter and cancellation via `AbortSignal`.
 *
 * @param progress Optional VS Code progress reporter for user feedback.
 * @param abortSignal Optional AbortSignal to cancel the operation.
 * @returns A promise that resolves when installation completes.
 * @throws Error If download or extraction fails.
 */
export async function installEmulator(
    progress?: vscode.Progress<{message?: string, increment?: number}>,
    abortSignal?: AbortSignal
): Promise<void> {

    const EMULATOR_URL = getOniroConfig(
        'emulatorUrl',
        'https://github.com/eclipse-oniro4openharmony/device_board_oniro/releases/latest/download/oniro_emulator.zip'
    );

    const EMULATOR_DIR = getEmulatorDir();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oniro-emulator-'));
    const tmpZip = path.join(tmpDir, 'oniro_emulator.zip');

    try {
        fs.mkdirSync(EMULATOR_DIR, { recursive: true });

        if (progress) { progress.report?.({ message: 'Downloading emulator...', increment: 0 }); }
        await downloadFile(EMULATOR_URL, tmpZip, progress, abortSignal, 0, 50);

        if (progress) { progress.report?.({ message: 'Extracting emulator...', increment: 0 }); }
        await extractZipWithProgress(tmpZip, EMULATOR_DIR, progress, 50, 45);
        
        const runSh = path.join(EMULATOR_DIR, 'images', 'run.sh');
        if (fs.existsSync(runSh)) {
            fs.chmodSync(runSh, 0o755);
        }

        if (progress) { progress.report?.({ message: 'Finalizing installation...', increment: 5 }); } // 95 -> 100

        if (progress) { progress.report?.({ message: 'Cleaning up...', increment: 0 }); }
        fs.rmSync(tmpDir, { recursive: true, force: true });

    } catch (err) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw err;
    }
}

/**
 * Remove the Oniro emulator installation directory, if present.
 *
 * Performs a recursive deletion of the configured emulator directory and is
 * suitable for cleanup operations in the SDK manager UI.
 */
export function removeEmulator(): void {
    const EMULATOR_DIR = getEmulatorDir();

    if (fs.existsSync(EMULATOR_DIR)) {
        fs.rmSync(EMULATOR_DIR, { recursive: true, force: true });
    }
}

/**
 * Detects the project SDK version by reading the compileSdkVersion field from build-profile.json5 at the project root.
 * 
 * @param projectRoot The absolute path to the project root directory.
 * @returns The compileSdkVersion as a number, or undefined if not found or on error.
 */
export function detectProjectSdkVersion(projectRoot: string): number | undefined {
    try {
        const buildProfilePath = path.join(projectRoot, 'build-profile.json5');

        if (!fs.existsSync(buildProfilePath)) {
            oniroLogChannel.appendLine(`build-profile.json5 not found at ${projectRoot}`);
            return undefined;
        }

        const fileContent = fs.readFileSync(buildProfilePath, 'utf-8');
        const config = JSON5.parse(fileContent);
        const products = config?.app?.products;

        if (Array.isArray(products) && products.length > 0) {
            const compileSdkVersion = products[0]?.compileSdkVersion;
            if (typeof compileSdkVersion === 'number') {
                return compileSdkVersion;
            }
        }

        return undefined;
    } catch (err) {
        oniroLogChannel.appendLine(`Error reading build-profile.json5 at ${projectRoot}: ${err}`);
        return undefined;
    }
}