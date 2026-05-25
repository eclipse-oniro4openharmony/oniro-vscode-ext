import * as os from 'os';
import * as vscode from 'vscode';
import type { ConfigKey, ConfigProvider } from '@oniroproject/core';

export const vscodeConfigProvider: ConfigProvider = {
    get<T extends string | number | boolean>(key: ConfigKey, fallback: T): T {
        const config = vscode.workspace.getConfiguration('oniro');
        let value = config.get<T>(key);

        if (typeof value === 'string' && value.includes('${userHome}')) {
            value = value.replace(/\$\{userHome\}/g, os.homedir()) as T;
        }

        if (value === undefined || value === null || value === '') {
            return fallback;
        }
        return value;
    },
};
