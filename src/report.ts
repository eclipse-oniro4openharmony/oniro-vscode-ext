import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

let storageDir: string | undefined;

export function initReports(context: vscode.ExtensionContext): void {
    storageDir = path.join(context.globalStorageUri.fsPath, 'reports');
}

/**
 * Write `markdown` to `<global storage>/reports/<name>.md` and open it in the
 * Markdown preview. Reports (crash analysis, doctor, HAP verification) are plain
 * Markdown so they follow the editor theme and their `file:line` links open the
 * source.
 */
export async function showMarkdownReport(name: string, markdown: string): Promise<vscode.Uri> {
    if (!storageDir) {
        throw new Error('Reports are not initialised.');
    }
    fs.mkdirSync(storageDir, { recursive: true });
    const file = path.join(storageDir, `${name}.md`);
    fs.writeFileSync(file, markdown, 'utf8');
    const uri = vscode.Uri.file(file);
    await vscode.commands.executeCommand('markdown.showPreview', uri);
    return uri;
}

/** A Markdown link that opens `file` at `line` (1-based) from the preview. */
export function fileLink(file: string, line?: number | null, column?: number | null, label?: string): string {
    const uri = vscode.Uri.file(file).with({ fragment: line ? `L${line}${column ? `,${column}` : ''}` : '' });
    const text = label ?? `${path.basename(file)}${line ? `:${line}` : ''}${line && column ? `:${column}` : ''}`;
    return `[${escapeMd(text)}](${uri.toString()})`;
}

/** Escape characters Markdown would otherwise interpret in inline text. */
export function escapeMd(text: string): string {
    return text.replace(/([\\`*_{}[\]<>|])/g, '\\$1');
}

/** A fenced code block that cannot be broken out of by its content. */
export function codeBlock(text: string, lang = ''): string {
    const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
    const fence = '`'.repeat(longest + 1);
    return `${fence}${lang}\n${text}\n${fence}`;
}
