import * as vscode from 'vscode';

import { CLIExecutor } from './cli-executor';
import { CONFIG_SECTION } from './config';
import { createLogger, Logger } from './log';
import { runFile } from './process';
import { resolveProvider } from './providers';

const COMMIT_PROMPT_TEMPLATE = `Generate a git commit message for the following changes.

IMPORTANT: Return ONLY the commit message text itself. Do not include:
- Any explanatory text like "Based on...", "Here's...", or "Here is..."
- Code blocks or backticks
- Any markdown formatting
- Any commentary before or after the message

Just return the raw commit message text that will be used directly in git commit.

Git diff:
{{diff}}

Rules:
- Use conventional commit format
- Keep under 72 characters for the first line
- Be specific and clear
- Common types: feat, fix, docs, style, refactor, test, chore

Remember: Return ONLY the commit message text, nothing else.`;

export function buildCommitPrompt(diff: string): string {
    return COMMIT_PROMPT_TEMPLATE.replace('{{diff}}', diff);
}

export class CommitMessageGenerator {
    private readonly cliExecutor: CLIExecutor;
    private readonly binaryPath: string;
    private readonly log: Logger;

    constructor() {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const debugMode = config.get<boolean>('debugMode') || false;
        this.log = createLogger(debugMode);

        const spec = resolveProvider(config.get<string>('provider'));
        const model = config.get<string>('model')?.trim() || spec.defaultModel;
        this.binaryPath = (config.get<string>('binaryPath') || '').trim();

        this.cliExecutor = new CLIExecutor(spec, model, this.log);
    }

    async generateCommitMessage(repositoryPath?: string): Promise<string> {
        try {
            await this.cliExecutor.detectBinaryPath(this.binaryPath || undefined);

            const cwd = repositoryPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!cwd) {
                throw new Error('No workspace folder open');
            }

            const { diff, isStaged } = await this.readDiff(cwd);
            if (!diff.trim()) {
                throw new Error('No changes found (staged or unstaged)');
            }
            this.log(`[GIT] ${isStaged ? 'staged' : 'unstaged'} diff: ${diff.length} chars`);

            const output = await this.cliExecutor.executeCommand(buildCommitPrompt(diff));
            return this.cliExecutor.parseResponse(output);
        } catch (error: any) {
            this.log(`[ERROR] ${error.message}`);
            if (error.message.includes('not found')) {
                throw new Error(`${error.message} See the Output panel for details.`);
            }
            throw new Error(`Failed to generate commit message: ${error.message}`);
        }
    }

    /** Return the staged diff, falling back to the unstaged diff. No shell is used. */
    private async readDiff(cwd: string): Promise<{ diff: string; isStaged: boolean }> {
        const staged = await runFile('git', ['diff', '--cached'], { cwd });
        if (staged.stdout.trim()) {
            return { diff: staged.stdout, isStaged: true };
        }
        const unstaged = await runFile('git', ['diff'], { cwd });
        return { diff: unstaged.stdout, isStaged: false };
    }
}
