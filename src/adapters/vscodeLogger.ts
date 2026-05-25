import type { Logger } from '@oniroproject/core';
import { oniroLogChannel } from '../utils/logger';

export const vscodeLogger: Logger = {
    debug: (m) => oniroLogChannel.appendLine(`[debug] ${m}`),
    info: (m) => oniroLogChannel.appendLine(`[info] ${m}`),
    warn: (m) => oniroLogChannel.appendLine(`[warn] ${m}`),
    error: (m) => oniroLogChannel.appendLine(`[error] ${m}`),
};
