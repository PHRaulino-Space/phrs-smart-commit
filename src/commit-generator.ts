import * as vscode from 'vscode';

import { CLIExecutor } from './cli-executor';
import { CONFIG_SECTION } from './config';
import { resolveLanguage } from './languages';
import { createLogger, Logger } from './log';
import { runFile } from './process';
import { resolveProvider } from './providers';

const COMMIT_PROMPT_TEMPLATE = `You are a git commit message generator. Analyze the git diff below and generate a single commit message following the Conventional Commits specification.

Git diff:
{{diff}}

Rules for the commit message:
- Format: <type>(<scope>): <description>
  - Scope is optional — omit it if the change doesn't clearly belong to one module/area
- Common types: feat, fix, docs, style, refactor, perf, test, chore, build, ci
- First line must be 72 characters or fewer
- Use imperative mood (e.g. "add", "fix", "update" — not "added", "fixes", "updating")
- Be specific about WHAT changed and WHY when relevant, not a literal line-by-line description of the diff
- If the diff touches multiple unrelated concerns, focus the subject line on the most significant change
- If a body would add real value (non-trivial change, breaking change, or non-obvious reasoning), add it after a blank line, as short bullet points
- Do not invent context that isn't in the diff — if the purpose isn't clear, describe the change factually

Output language: write the commit message in {{language}} (e.g. "Brazilian Portuguese", "English", "Spanish"). Keep conventional commit type keywords (feat, fix, docs, etc.) in English regardless of output language, since these are part of the spec and used by tooling.

IMPORTANT — output format:
Return ONLY the raw commit message text, nothing else. Do not include:
- Explanatory text like "Based on...", "Here's...", "Here is..."
- Code blocks, backticks, or markdown formatting
- Commentary before or after the message
- Quotes wrapping the message
The output will be piped directly into \`git commit -m\`.`;

export function buildCommitPrompt(diff: string, language: string): string {
    // Use function replacers so `$`-sequences in the diff (e.g. `$&`, `$1`) are
    // inserted literally instead of being treated as replacement patterns.
    return COMMIT_PROMPT_TEMPLATE
        .replace('{{diff}}', () => diff)
        .replace('{{language}}', () => language);
}

export class CommitMessageGenerator {
    private readonly cliExecutor: CLIExecutor;
    private readonly binaryPath: string;
    private readonly language: string;
    private readonly log: Logger;

    constructor() {
        const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const debugMode = config.get<boolean>('debugMode') || false;
        this.log = createLogger(debugMode);

        const spec = resolveProvider(config.get<string>('provider'));
        const model = config.get<string>('model')?.trim() || spec.defaultModel;
        this.binaryPath = (config.get<string>('binaryPath') || '').trim();
        this.language = resolveLanguage(config.get<string>('language'));

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

            const output = await this.cliExecutor.executeCommand(buildCommitPrompt(diff, this.language));
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
