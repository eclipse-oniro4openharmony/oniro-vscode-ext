import * as vscode from 'vscode';
import type { BuildDiagnostic } from '@oniroproject/core';
import { resolveProjectFile } from './utils/project';

/**
 * Problems-panel integration for the diagnostics core parses out of hvigor builds,
 * `check arkts` runs and failed test builds. Each producer owns one collection, so a
 * clean `check arkts` run does not wipe the errors of the last build and vice versa.
 */
export class OniroDiagnostics implements vscode.Disposable {
    readonly build = vscode.languages.createDiagnosticCollection('oniro-build');
    readonly arkts = vscode.languages.createDiagnosticCollection('oniro-arkts');

    dispose(): void {
        this.build.dispose();
        this.arkts.dispose();
    }
}

/**
 * Diagnostics without a file (hvigor configuration errors, a missing SDK, ohpm
 * failures) are attached to build-profile.json5 so they still reach the Problems panel.
 */
const FALLBACK_FILE = 'build-profile.json5';

export function toVscodeDiagnostic(d: BuildDiagnostic): vscode.Diagnostic {
    const line = Math.max(0, (d.line ?? 1) - 1);
    const col = Math.max(0, (d.column ?? 1) - 1);
    const range = new vscode.Range(line, col, line, d.line ? Number.MAX_SAFE_INTEGER : col);
    const severity = d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
    const message = d.task && !d.file ? `${d.message} (${d.task})` : d.message;
    const diag = new vscode.Diagnostic(range, message, severity);
    diag.source = `oniro ${d.source}`;
    const code = d.rule ?? d.code;
    if (code) {
        diag.code = code;
    }
    return diag;
}

/**
 * Replace the contents of `collection` with `diagnostics`. When `scope` is given, only
 * those files are replaced (a per-file `check arkts` on save must not drop the
 * findings of other files).
 */
export function publishDiagnostics(
    collection: vscode.DiagnosticCollection,
    projectDir: string,
    diagnostics: readonly BuildDiagnostic[],
    scope?: readonly string[],
): void {
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const d of diagnostics) {
        const file = resolveProjectFile(projectDir, d.file ?? FALLBACK_FILE);
        const list = byFile.get(file) ?? [];
        list.push(toVscodeDiagnostic(d));
        byFile.set(file, list);
    }

    if (scope) {
        for (const f of scope) {
            const abs = resolveProjectFile(projectDir, f);
            collection.set(vscode.Uri.file(abs), byFile.get(abs) ?? []);
            byFile.delete(abs);
        }
        for (const [file, list] of byFile) {
            collection.set(vscode.Uri.file(file), list);
        }
        return;
    }

    collection.clear();
    for (const [file, list] of byFile) {
        collection.set(vscode.Uri.file(file), list);
    }
}
