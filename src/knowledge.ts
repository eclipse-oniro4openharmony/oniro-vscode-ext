import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    type ApiIndex,
    type ApiSearchHit,
    type DocSearchHit,
    DocsIndex,
    docsDirFor,
    docsRefFor,
    docsTree,
    getApiIndexCacheDir,
    loadApiIndex,
    readSdkRelease,
    resolveApiSdk,
    searchApi,
    syncDocs,
} from '@oniroproject/core';
import { tokenToSignal, vscodeConfigProvider, vscodeLogger } from './adapters';
import { errorMessage, isCancellation, tryGetWorkspaceRoot } from './utils/project';

/** The SDK API directory the workspace project compiles against (else the newest installed). */
function selectSdk(): { sdkDir: string; api?: number; note?: string } {
    const root = tryGetWorkspaceRoot();
    return resolveApiSdk(vscodeConfigProvider, { projectDir: root });
}

const indexCache = new Map<string, ApiIndex>();

export async function openApiIndex(): Promise<ApiIndex> {
    const sel = selectSdk();
    const cached = indexCache.get(sel.sdkDir);
    if (cached) { return cached; }
    if (sel.note) { vscodeLogger.warn(sel.note); }
    const loaded = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Oniro: Indexing the API ${sel.api ?? ''} SDK declarations (first use only)…`,
    }, async () => {
        // Let the notification paint before the synchronous index build.
        await new Promise((r) => setTimeout(r, 50));
        return loadApiIndex(sel.sdkDir, { cacheDir: getApiIndexCacheDir(vscodeConfigProvider), logger: vscodeLogger });
    });
    indexCache.set(sel.sdkDir, loaded.index);
    return loaded.index;
}

function apiHitDetail(h: ApiSearchHit): string {
    const bits: string[] = [h.kind];
    if (h.kit) { bits.push(h.kit); } else { bits.push(h.module); }
    if (h.since) { bits.push(`since API ${h.since}`); }
    if (h.deprecated !== undefined) { bits.push('deprecated'); }
    if (h.systemApi) { bits.push('system API'); }
    return bits.join(' · ');
}

/**
 * Line after the last top-level import statement of `text` (0 when there is none).
 * Statements may span lines (`import {\n  a,\n  b\n} from 'x';`). Pure.
 */
export function lineAfterImports(text: string): number {
    const re = /^[ \t]*import\b[^;'"]*?(?:\bfrom\s*)?(['"])[^'"\n]*\1[ \t]*;?/gm;
    let end = -1;
    for (let m = re.exec(text); m; m = re.exec(text)) { end = m.index + m[0].length; }
    if (end < 0) { return 0; }
    return text.slice(0, end).split('\n').length;
}

/** Add `import` to `editor` (an ArkTS file), after its existing imports. */
async function insertImport(editor: vscode.TextEditor | undefined, statement: string): Promise<void> {
    if (!editor || editor.document.isClosed) {
        vscode.window.showWarningMessage(`Open the ArkTS file to add the import to: ${statement}`);
        return;
    }
    const doc = editor.document;
    const text = doc.getText();
    if (text.includes(statement)) {
        vscode.window.setStatusBarMessage('Import already present', 3000);
        return;
    }
    const pos = new vscode.Position(lineAfterImports(text), 0);
    await editor.edit((e) => e.insert(pos, `${statement};\n`));
}

/**
 * Search what the project's SDK declares (ArkTS API, ArkUI components and decorators,
 * Node-API), read from the SDK's own typings. Pick a hit to open its declaration, or
 * insert its import into the current file.
 */
export async function searchApiCommand(initial?: string): Promise<void> {
    // The file an import would go into: captured now, before the declaration opens.
    const editor = vscode.window.activeTextEditor;
    const target = editor?.document.uri.scheme === 'file' && editor.document.fileName.endsWith('.ets') ? editor : undefined;
    let index: ApiIndex;
    try {
        index = await openApiIndex();
    } catch (err) {
        vscode.window.showErrorMessage(`Cannot search the SDK API: ${errorMessage(err)}`);
        return;
    }

    type Item = vscode.QuickPickItem & { hit?: ApiSearchHit };
    const qp = vscode.window.createQuickPick<Item>();
    qp.title = `OpenHarmony API search (API ${index.api ?? '?'}, ${index.entries.length} declarations)`;
    qp.placeholder = 'Type a symbol, e.g. NavPathStack push, router.pushUrl, @Local, napi_create';
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    const insertButton: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('insert'), tooltip: 'Insert import into the current file' };
    const update = (q: string) => {
        if (!q.trim()) {
            qp.items = [];
            return;
        }
        const res = searchApi(index, q, { limit: 50 });
        qp.items = res.hits.map((h) => ({
            label: h.qualifiedName,
            description: apiHitDetail(h),
            detail: h.doc ?? h.signature,
            hit: h,
            alwaysShow: true,
            buttons: h.import ? [insertButton] : [],
        }));
    };
    qp.onDidChangeValue(update);
    if (initial) {
        qp.value = initial;
        update(initial);
    }

    const result = await new Promise<{ item: Item; insert: boolean } | undefined>((resolve) => {
        qp.onDidAccept(() => resolve(qp.selectedItems[0] ? { item: qp.selectedItems[0], insert: false } : undefined));
        qp.onDidTriggerItemButton((e) => resolve({ item: e.item, insert: true }));
        qp.onDidHide(() => resolve(undefined));
        qp.show();
    });
    qp.dispose();
    const hit = result?.item.hit;
    if (!hit) { return; }
    if (result.insert && hit.import) {
        await insertImport(target, hit.import);
        return;
    }

    const file = path.join(index.sdkDir, hit.file);
    if (fs.existsSync(file)) {
        const line = Math.max(0, hit.line - 1);
        await vscode.window.showTextDocument(vscode.Uri.file(file), {
            selection: new vscode.Range(line, 0, line, 0),
            preview: true,
            preserveFocus: true,
            viewColumn: vscode.ViewColumn.Beside,
        });
    }
    const actions = hit.import ? ['Insert Import'] : [];
    const choice = await vscode.window.showInformationMessage(
        `${hit.qualifiedName} (${apiHitDetail(hit)}): ${hit.import ?? (hit.global ? 'global, no import needed' : hit.module)}`,
        ...actions,
    );
    if (choice === 'Insert Import' && hit.import) {
        await insertImport(target, hit.import);
    }
}

/** The docs release matching the project's SDK, and where its clone lives. */
export function selectDocs(): { ref: string; dir: string } {
    let ref: string;
    try {
        const sel = selectSdk();
        const release = readSdkRelease(sel.sdkDir);
        ref = docsRefFor({ api: release.api ?? sel.api, version: release.version });
    } catch {
        ref = 'master';
    }
    return { ref, dir: docsDirFor(vscodeConfigProvider, ref) };
}

/** Clone or update the OpenHarmony docs of the project's release (about 100 MB). */
export async function syncDocsCommand(): Promise<boolean> {
    const { ref, dir } = selectDocs();
    try {
        const res = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Oniro: Syncing the OpenHarmony docs (${ref}, ~100 MB)…`,
            cancellable: true,
        }, async (_p, token) => {
            const bridge = tokenToSignal(token);
            try {
                return await syncDocs({ ref, dir, logger: vscodeLogger, abortSignal: bridge.signal });
            } finally {
                bridge.dispose();
            }
        });
        const tree = docsTree(res.dir);
        if (tree) { DocsIndex.forget(tree); }
        vscode.window.showInformationMessage(`OpenHarmony docs ${res.ref} ${res.updated ? 'updated' : 'synced'}: ${res.files} documents.`);
        return true;
    } catch (err) {
        if (isCancellation(err)) {
            vscode.window.showWarningMessage('Docs sync cancelled.');
        } else {
            vscode.window.showErrorMessage(`Docs sync failed: ${errorMessage(err)}`);
        }
        return false;
    }
}

/** Full-text search of the OpenHarmony application-development docs; opens the hit in the preview. */
export async function searchDocsCommand(initial?: string): Promise<void> {
    const { ref, dir } = selectDocs();
    let tree = docsTree(dir);
    if (!tree) {
        const choice = await vscode.window.showInformationMessage(
            `The OpenHarmony ${ref} docs are not downloaded yet. Download them now? (a partial clone of gitcode.com/openharmony/docs, about 100 MB; needs git)`,
            'Download',
        );
        if (choice !== 'Download' || !(await syncDocsCommand())) { return; }
        tree = docsTree(dir);
        if (!tree) { return; }
    }
    const docsRoot = tree;
    const index = await vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: 'Indexing docs…' }, async () => DocsIndex.load(docsRoot));

    type Item = vscode.QuickPickItem & { hit?: DocSearchHit; heading?: number };
    const qp = vscode.window.createQuickPick<Item>();
    qp.title = `OpenHarmony docs (${ref}, ${index.size} documents)`;
    qp.placeholder = 'Search the docs, e.g. NavPathStack, request permission, 401 error code';
    qp.matchOnDescription = true;
    qp.matchOnDetail = true;
    let timer: NodeJS.Timeout | undefined;
    const update = (q: string) => {
        if (!q.trim()) {
            qp.items = [];
            return;
        }
        const res = index.search(q, { limit: 30 });
        const items: Item[] = [];
        for (const h of res.hits) {
            items.push({ label: `$(book) ${h.title}`, description: h.path, detail: h.snippet, hit: h, alwaysShow: true });
            for (const hd of h.headings.slice(0, 3)) {
                items.push({ label: `    $(symbol-key) ${hd.text}`, description: h.title, hit: h, heading: hd.line, alwaysShow: true });
            }
        }
        qp.items = items;
    };
    qp.onDidChangeValue((q) => {
        if (timer) { clearTimeout(timer); }
        timer = setTimeout(() => update(q), 120);
    });
    if (initial) {
        qp.value = initial;
        update(initial);
    }
    const picked = await new Promise<Item | undefined>((resolve) => {
        qp.onDidAccept(() => resolve(qp.selectedItems[0]));
        qp.onDidHide(() => resolve(undefined));
        qp.show();
    });
    qp.dispose();
    if (!picked?.hit) { return; }
    const file = path.join(docsRoot, picked.hit.path);
    const uri = vscode.Uri.file(file);
    if (picked.heading !== undefined) {
        // Open the source at the heading; the preview beside it scrolls along.
        const line = Math.max(0, picked.heading - 1);
        await vscode.window.showTextDocument(uri, { selection: new vscode.Range(line, 0, line, 0), preview: true });
        await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
    } else {
        await vscode.commands.executeCommand('markdown.showPreview', uri);
    }
}
