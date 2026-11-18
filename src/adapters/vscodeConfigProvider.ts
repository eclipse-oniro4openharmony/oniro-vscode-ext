import * as os from 'os';
import * as vscode from 'vscode';
import type { ConfigKey, ConfigProvider } from '@oniroproject/core';
import { isScaffoldHapPath } from '../utils/project';

export const vscodeConfigProvider: ConfigProvider = {
    get<T extends string | number | boolean>(key: ConfigKey, fallback: T): T {
        const config = vscode.workspace.getConfiguration('oniro');
        let value = config.get<T>(key);

        if (typeof value === 'string' && value.includes('${userHome}')) {
            value = value.replace(/\$\{userHome\}/g, os.homedir()) as T;
        }

        // Projects created by earlier versions carry a generated hapPath in their workspace
        // settings; honouring it would stop core from finding the HAP the build produced.
        if (key === 'hapPath' && isScaffoldHapPath(value)) {
            return fallback;
        }

        if (value === undefined || value === null || value === '') {
            return fallback;
        }
        return value;
    },
};
