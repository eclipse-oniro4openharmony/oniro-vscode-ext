import * as vscode from 'vscode';

export interface CancellationBridge {
    signal: AbortSignal;
    dispose(): void;
}

export function tokenToSignal(token: vscode.CancellationToken): CancellationBridge {
    const controller = new AbortController();
    if (token.isCancellationRequested) {
        controller.abort();
    }
    const sub = token.onCancellationRequested(() => controller.abort());
    return {
        signal: controller.signal,
        dispose: () => sub.dispose(),
    };
}
