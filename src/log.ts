import * as vscode from 'vscode';

export const outputChannel = vscode.window.createOutputChannel('PHRS Smart Commit');

export type Logger = (message: string) => void;

/** A logger that writes to the output channel only when debug mode is enabled. */
export function createLogger(debugMode: boolean): Logger {
    return debugMode ? (message) => outputChannel.appendLine(message) : () => undefined;
}
