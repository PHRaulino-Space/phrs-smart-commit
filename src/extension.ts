import * as vscode from 'vscode';

import { CommitMessageGenerator } from './commit-generator';
import { COMMAND_ID, CONFIG_SECTION } from './config';
import { outputChannel } from './log';
import { resolveProvider } from './providers';

/** Resolve the repository the command should act on, prompting the user if ambiguous. */
async function resolveTargetRepo(uri: vscode.Uri | undefined): Promise<any | undefined> {
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    if (!gitExtension) {
        vscode.window.showErrorMessage('Git extension not available');
        return undefined;
    }
    const git = gitExtension.getAPI(1);
    const repos: any[] = git.repositories;

    if (uri) {
        const uriPath = uri.fsPath;
        const match = repos.find((repo) => uriPath.startsWith(repo.rootUri.fsPath));
        if (match) {
            return match;
        }
    }

    if (repos.length === 1) {
        return repos[0];
    }
    if (repos.length === 0) {
        vscode.window.showErrorMessage('No Git repository found');
        return undefined;
    }

    const selected = await vscode.window.showQuickPick(
        repos.map((repo) => ({ label: repo.rootUri.fsPath, repo })),
        { placeHolder: 'Select repository' },
    );
    return selected?.repo;
}

export function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    if (config.get<boolean>('debugMode')) {
        outputChannel.appendLine('=== EXTENSION ACTIVATED ===');
        outputChannel.show();
    }

    const disposable = vscode.commands.registerCommand(COMMAND_ID, async (uri?: vscode.Uri) => {
        const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const debug = cfg.get<boolean>('debugMode') || false;
        const provider = resolveProvider(cfg.get<string>('provider'));

        try {
            const targetRepo = await resolveTargetRepo(uri);
            if (!targetRepo) {
                return;
            }

            const generator = new CommitMessageGenerator();
            const commitMessage = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Generating commit message with ${provider.label}...`,
                    cancellable: true,
                },
                async (_progress, token) => {
                    token.onCancellationRequested(() => {
                        if (debug) {
                            outputChannel.appendLine('[GENERATE] Cancelled by user');
                        }
                    });
                    return generator.generateCommitMessage(targetRepo.rootUri.fsPath);
                },
            );

            if (commitMessage) {
                targetRepo.inputBox.value = commitMessage;
                vscode.window.showInformationMessage('Commit message generated!');
            }
        } catch (error: any) {
            if (debug) {
                outputChannel.appendLine(`[ERROR] Command failed: ${error.message}`);
                outputChannel.show();
            }
            vscode.window.showErrorMessage(
                `Error: ${error.message}\n\nCheck 'PHRS Smart Commit' in the Output panel for detailed logs.`,
            );
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {
    // VS Code disposes the output channel automatically on extension unload.
}
