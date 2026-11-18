import * as vscode from 'vscode';

export interface CancellationBridge {
    signal: AbortSignal;
    /** Abort from our side too (e.g. an outer operation was cancelled). */
    abort(): void;
    dispose(): void;
}

export function tokenToSignal(token?: vscode.CancellationToken): CancellationBridge {
    const controller = new AbortController();
    if (token?.isCancellationRequested) {
        controller.abort();
    }
    const sub = token?.onCancellationRequested(() => controller.abort());
    return {
        signal: controller.signal,
        abort: () => controller.abort(),
        dispose: () => sub?.dispose(),
    };
}
