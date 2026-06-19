import * as vscode from 'vscode';

import { CommitMessageGenerator, LargeDiffChoice, LargeDiffInfo } from './commit-generator';
import { COMMAND_ID, CONFIG_SECTION } from './config';
import { outputChannel } from './log';
import { resolveProvider } from './providers';

/** Ask the user how to handle an oversized diff: summarise via `--stat`, or cancel. */
async function promptLargeDiff({ bytes, limitBytes }: LargeDiffInfo): Promise<LargeDiffChoice> {
    const kb = Math.round(bytes / 1024);
    const limitKb = Math.round(limitBytes / 1024);
    const useSummary = 'Generate from summary';
    const choice = await vscode.window.showWarningMessage(
        `The diff is too large (${kb} KB > ${limitKb} KB) to produce a good commit message.`,
        {
            modal: true,
            detail: 'Generate the message from a summary (git diff --stat), or cancel and split your changes into smaller commits.',
        },
        useSummary,
    );
    return choice === useSummary ? 'summary' : 'abort';
}

/** Resolve the repository the command should act on, prompting the user if ambiguous. */
async function resolveTargetRepo(arg: vscode.Uri | any | undefined): Promise<any | undefined> {
    const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
    if (!gitExtension) {
        vscode.window.showErrorMessage('Git extension not available');
        return undefined;
    }
    const git = gitExtension.getAPI(1);
    const repos: any[] = git.repositories;

    // scm/title passes a SourceControl object with rootUri (not a plain Uri)
    if (arg?.rootUri?.fsPath) {
        const match = repos.find((repo) => repo.rootUri.fsPath === arg.rootUri.fsPath);
        if (match) {
            return match;
        }
    }

    // scm/resourceGroup/inline passes a Uri directly
    if (arg?.fsPath) {
        const uriPath = arg.fsPath;
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

    const disposable = vscode.commands.registerCommand(COMMAND_ID, async (uri?: vscode.Uri | any) => {
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
                    return generator.generateCommitMessage(targetRepo.rootUri.fsPath, promptLargeDiff);
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
