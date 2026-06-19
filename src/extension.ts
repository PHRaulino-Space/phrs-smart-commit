import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

const CONFIG_SECTION = 'phrs-claude-commit';
const COMMAND_ID = 'phrs-claude-commit.createCommitMessage';

const outputChannel = vscode.window.createOutputChannel('PHRS Claude Commit');

type ExecResult = { stdout: string; stderr: string };

async function runFile(
    file: string,
    args: string[],
    options: { cwd?: string; timeout?: number; input?: string; maxBuffer?: number } = {},
): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve, reject) => {
        const child = execFile(
            file,
            args,
            {
                cwd: options.cwd,
                timeout: options.timeout,
                maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
                shell: false,
            },
            (error, stdout, stderr) => {
                if (error && (error as NodeJS.ErrnoException).code !== 'ETIMEDOUT') {
                    if (stdout || stderr) {
                        resolve({ stdout: String(stdout), stderr: String(stderr) });
                    } else {
                        reject(error);
                    }
                } else if (error) {
                    reject(error);
                } else {
                    resolve({ stdout: String(stdout), stderr: String(stderr) });
                }
            },
        );

        if (child.stdin) {
            if (options.input !== undefined) {
                child.stdin.end(options.input);
            } else {
                child.stdin.end();
            }
        }
    });
}

class ClaudeCLIExecutor {
    private claudePath: string | null = null;
    private debugMode: boolean;

    constructor(debugMode: boolean = false) {
        this.debugMode = debugMode;
        if (this.debugMode) {
            outputChannel.appendLine('[DEBUG] ClaudeCLIExecutor initialized');
        }
    }

    private log(message: string): void {
        if (this.debugMode) {
            outputChannel.appendLine(message);
        }
    }

    private async isExecutableFile(candidate: string): Promise<boolean> {
        try {
            const stat = await fs.stat(candidate);
            return stat.isFile();
        } catch {
            return false;
        }
    }

    private async probe(candidate: string): Promise<boolean> {
        // Probe with `--version` WITHOUT a shell. Arguments here are constants,
        // and the candidate path is passed as argv[0] so shell metachars in it
        // cannot cause command injection.
        try {
            await runFile(candidate, ['--version'], { timeout: 10_000 });
            return true;
        } catch (error: any) {
            this.log(`[PROBE] ${candidate} failed: ${error.message}`);
            return false;
        }
    }

    async detectClaudePath(customPath?: string): Promise<string> {
        this.log('\n=== CLAUDE PATH DETECTION START ===');

        if (customPath && customPath.trim() !== '') {
            const trimmed = customPath.trim();
            this.log(`[CUSTOM PATH] Checking: ${trimmed}`);

            if (!(await this.isExecutableFile(trimmed))) {
                throw new Error(`Custom Claude CLI path is not a file: ${trimmed}`);
            }
            if (!(await this.probe(trimmed))) {
                throw new Error(`Custom Claude CLI path did not respond to --version: ${trimmed}`);
            }

            this.claudePath = trimmed;
            this.log(`[CUSTOM PATH] ✓ Set claudePath to: ${trimmed}`);
            return trimmed;
        }

        const isWindows = process.platform === 'win32';
        const lookupBin = isWindows ? 'where' : 'which';
        try {
            const { stdout } = await runFile(lookupBin, ['claude'], { timeout: 5_000 });
            const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
            if (first && (await this.probe(first))) {
                this.claudePath = first;
                this.log(`[PATH SEARCH] ✓ Found at: ${first}`);
                return first;
            }
        } catch (error: any) {
            this.log(`[PATH SEARCH] ${lookupBin} failed: ${error.message}`);
        }

        if (!isWindows) {
            for (const shell of ['/bin/zsh', '/bin/bash']) {
                try {
                    const { stdout } = await runFile(shell, ['-l', '-c', 'command -v claude'], {
                        timeout: 5_000,
                    });
                    const candidate = stdout.trim().split(/\r?\n/).pop()?.trim();
                    if (candidate && (await this.probe(candidate))) {
                        this.claudePath = candidate;
                        this.log(`[LOGIN SHELL] ✓ Found via ${shell}: ${candidate}`);
                        return candidate;
                    }
                } catch (error: any) {
                    this.log(`[LOGIN SHELL] ${shell} failed: ${error.message}`);
                }
            }
        }

        const home = process.env.HOME || process.env.USERPROFILE || '';
        const commonPaths: string[] = [
            '/usr/local/bin/claude',
            '/usr/bin/claude',
            '/opt/homebrew/bin/claude',
        ];
        if (home) {
            commonPaths.push(path.join(home, '.local', 'bin', 'claude'));

            // Scan NVM directory for any claude binary without using `find`.
            const nvmRoot = path.join(home, '.nvm', 'versions', 'node');
            try {
                const versions = await fs.readdir(nvmRoot);
                for (const version of versions) {
                    commonPaths.unshift(path.join(nvmRoot, version, 'bin', 'claude'));
                }
            } catch {
                // No NVM install — fine.
            }
        }

        for (const candidate of commonPaths) {
            if (await this.isExecutableFile(candidate)) {
                if (await this.probe(candidate)) {
                    this.claudePath = candidate;
                    this.log(`[COMMON PATHS] ✓ Set claudePath to: ${candidate}`);
                    return candidate;
                }
            }
        }

        if (await this.probe('claude')) {
            this.claudePath = 'claude';
            this.log('[DIRECT EXEC] ✓ Using "claude" directly');
            return 'claude';
        }

        throw new Error(
            'Claude CLI not found. Please ensure Claude Code is installed and on your PATH, or set a custom path in the extension settings.',
        );
    }

    async executeCommand(prompt: string): Promise<string> {
        if (!this.claudePath) {
            await this.detectClaudePath();
        }
        if (!this.claudePath || this.claudePath.trim() === '') {
            throw new Error('Claude path could not be determined');
        }

        this.log('\n=== EXECUTE COMMAND ===');
        this.log(`[EXECUTE] Using path: ${this.claudePath}`);
        this.log(`[EXECUTE] Prompt length: ${prompt.length} chars`);

        const args = ['--print', '--model', 'sonnet', '--output-format', 'json'];

        try {
            const startTime = Date.now();
            const { stdout, stderr } = await runFile(this.claudePath, args, {
                input: prompt,
                timeout: 60_000,
                maxBuffer: 10 * 1024 * 1024,
            });
            const duration = Date.now() - startTime;

            this.log(`[EXECUTE] ✓ Done in ${duration}ms`);
            this.log(`[EXECUTE] stdout: ${stdout.length} chars, stderr: ${stderr.length} chars`);
            if (stderr) {
                this.log(`[EXECUTE] stderr content: ${stderr}`);
            }

            const output = stdout.trim() || stderr.trim();
            if (!output) {
                throw new Error('No output received from Claude CLI');
            }
            return output;
        } catch (error: any) {
            this.log(`[EXECUTE] ✗ ${error.message}`);
            if (error.code === 'ETIMEDOUT') {
                throw new Error('Claude CLI timed out after 60 seconds. Please check if Claude is authenticated.');
            }
            throw new Error(`Claude CLI execution failed: ${error.message}`);
        }
    }

    parseResponse(output: string): string {
        if (!output) {
            return '';
        }

        try {
            const parsed = JSON.parse(output);
            this.log(`[PARSE] ✓ JSON parsed. Keys: ${Object.keys(parsed).join(', ')}`);

            if (parsed.result !== undefined && parsed.result !== null) {
                if (parsed.subtype === 'error_during_execution' || parsed.is_error) {
                    throw new Error('Claude returned an error response');
                }

                let finalResult = String(parsed.result).trim();

                const codeBlockMatch = finalResult.match(/```[\s\S]*?\n([\s\S]*?)\n```/);
                if (codeBlockMatch) {
                    finalResult = codeBlockMatch[1].trim();
                } else {
                    const lines = finalResult.split('\n');
                    const filteredLines: string[] = [];
                    let foundCommitStart = false;

                    for (const line of lines) {
                        if (
                            !foundCommitStart &&
                            (line.toLowerCase().includes('based on') ||
                                line.toLowerCase().includes("here's") ||
                                line.toLowerCase().includes('here is') ||
                                line.toLowerCase().includes('commit message') ||
                                line.trim() === '')
                        ) {
                            continue;
                        }
                        foundCommitStart = true;
                        filteredLines.push(line);
                    }
                    if (filteredLines.length > 0) {
                        finalResult = filteredLines.join('\n').trim();
                    }
                }

                return finalResult;
            }

            if (typeof parsed.text === 'string') { return parsed.text.trim(); }
            if (typeof parsed.message === 'string') { return parsed.message; }
            if (typeof parsed.content === 'string') { return parsed.content; }
            if (typeof parsed === 'string') { return parsed; }

            throw new Error('Could not extract commit message from Claude response. Check Output panel for details.');
        } catch (error: any) {
            this.log(`[PARSE] JSON parse failed: ${error.message}. Falling back to plain text.`);

            const cleaned = output.trim()
                .replace(/^```[a-zA-Z]*\n?/, '')
                .replace(/\n?```$/, '');

            const lines = cleaned.split('\n');
            for (const line of lines) {
                if (line.match(/^(feat|fix|docs|style|refactor|test|chore|build|ci|perf)(\(.+\))?:/i)) {
                    return line;
                }
            }
            return cleaned;
        }
    }
}

class CommitMessageGenerator {
    private cliExecutor: ClaudeCLIExecutor;
    private config: vscode.WorkspaceConfiguration;
    private debugMode: boolean;

    constructor() {
        this.config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        this.debugMode = this.config.get<boolean>('debugMode') || false;
        this.cliExecutor = new ClaudeCLIExecutor(this.debugMode);
    }

    private log(message: string): void {
        if (this.debugMode) {
            outputChannel.appendLine(message);
        }
    }

    async generateCommitMessage(repositoryPath?: string): Promise<string> {
        try {
            const claudePath = this.config.get<string>('claudePath');
            if (claudePath && claudePath.trim() !== '') {
                await this.cliExecutor.detectClaudePath(claudePath);
            } else {
                await this.cliExecutor.detectClaudePath();
            }

            const cwd = repositoryPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!cwd) {
                throw new Error('No workspace folder open');
            }

            // `git` invocations: arguments are constants, cwd is a known repo path.
            // Using execFile (no shell) keeps this safe even if cwd contains odd chars.
            let { stdout: diff } = await runFile('git', ['diff', '--cached'], { cwd });
            let isStaged = true;

            if (!diff.trim()) {
                const result = await runFile('git', ['diff'], { cwd });
                diff = result.stdout;
                isStaged = false;
            }

            if (!diff.trim()) {
                throw new Error('No changes found (staged or unstaged)');
            }

            this.log(`[GIT] ${isStaged ? 'staged' : 'unstaged'} diff: ${diff.length} chars`);

            const prompt = `Generate a git commit message for the following changes.

IMPORTANT: Return ONLY the commit message text itself. Do not include:
- Any explanatory text like "Based on...", "Here's...", or "Here is..."
- Code blocks or backticks
- Any markdown formatting
- Any commentary before or after the message

Just return the raw commit message text that will be used directly in git commit.

Git diff:
${diff}

Rules:
- Use conventional commit format
- Keep under 72 characters for the first line
- Be specific and clear
- Common types: feat, fix, docs, style, refactor, test, chore

Remember: Return ONLY the commit message text, nothing else.`;

            const output = await this.cliExecutor.executeCommand(prompt);
            return this.cliExecutor.parseResponse(output);
        } catch (error: any) {
            this.log(`[ERROR] ${error.message}`);
            if (error.message.includes('Claude CLI not found')) {
                throw new Error('Claude CLI not found. Please check the Output panel for details and ensure the Claude path is correctly configured in settings.');
            }
            throw new Error(`Failed to generate commit message: ${error.message}`);
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    const debugMode = config.get<boolean>('debugMode') || false;

    if (debugMode) {
        outputChannel.appendLine('=== EXTENSION ACTIVATED ===');
        outputChannel.show();
    }

    const createCommitDisposable = vscode.commands.registerCommand(COMMAND_ID, async (uri?: vscode.Uri) => {
        const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
        const debug = cfg.get<boolean>('debugMode') || false;

        try {
            const generator = new CommitMessageGenerator();

            const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
            if (!gitExtension) {
                vscode.window.showErrorMessage('Git extension not available');
                return;
            }

            const git = gitExtension.getAPI(1);
            let targetRepo;

            if (uri) {
                const uriPath = uri.fsPath;
                targetRepo = git.repositories.find((repo: any) => {
                    const repoPath = repo.rootUri.fsPath;
                    return uriPath && uriPath.startsWith(repoPath);
                });
            }

            if (!targetRepo) {
                if (git.repositories.length > 1) {
                    const repoItems = git.repositories.map((repo: any) => ({
                        label: repo.rootUri.fsPath,
                        repo,
                    }));
                    const selected = await vscode.window.showQuickPick(repoItems, {
                        placeHolder: 'Select repository',
                    });
                    if (!selected) {
                        return;
                    }
                    targetRepo = (selected as any).repo;
                } else if (git.repositories.length === 1) {
                    targetRepo = git.repositories[0];
                } else {
                    vscode.window.showErrorMessage('No Git repository found');
                    return;
                }
            }

            const commitMessage = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Generating commit message with Claude CLI...',
                    cancellable: true,
                },
                async (_progress, token) => {
                    token.onCancellationRequested(() => {
                        if (debug) {
                            outputChannel.appendLine('[GENERATE] Cancelled by user');
                        }
                    });
                    return await generator.generateCommitMessage(targetRepo.rootUri.fsPath);
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
                `Error: ${error.message}\n\nCheck 'PHRS Claude Commit' in the Output panel for detailed logs.`,
            );
        }
    });

    context.subscriptions.push(createCommitDisposable);
}

export function deactivate() {
    // VS Code disposes the output channel automatically on extension unload.
}
