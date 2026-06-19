import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

const CONFIG_SECTION = 'phrs-smart-commit';
const COMMAND_ID = 'phrs-smart-commit.createCommitMessage';

const outputChannel = vscode.window.createOutputChannel('PHRS Smart Commit');

type ExecResult = { stdout: string; stderr: string };

type PromptDelivery = 'stdin' | 'arg';
type OutputFormat = 'claude-json' | 'text';

interface ProviderSpec {
    id: string;
    label: string;
    /** Binary name searched on PATH when no custom path is set. */
    defaultBinary: string;
    /** Model used when the user leaves the `model` setting empty. */
    defaultModel: string;
    /** How the prompt is handed to the CLI. */
    promptVia: PromptDelivery;
    /** How the CLI's output is parsed. */
    outputFormat: OutputFormat;
    /**
     * Build the argv (excluding the binary itself). When `promptVia === 'arg'`,
     * the prompt is appended as the final argument by the executor.
     */
    buildArgs(model: string): string[];
}

const PROVIDERS: Record<string, ProviderSpec> = {
    claude: {
        id: 'claude',
        label: 'Claude Code',
        defaultBinary: 'claude',
        defaultModel: 'sonnet',
        promptVia: 'stdin',
        outputFormat: 'claude-json',
        buildArgs: (model) => ['--print', '--model', model, '--output-format', 'json'],
    },
    gemini: {
        id: 'gemini',
        label: 'Gemini CLI',
        defaultBinary: 'gemini',
        defaultModel: 'gemini-2.5-flash',
        promptVia: 'stdin',
        outputFormat: 'text',
        buildArgs: (model) => ['-m', model],
    },
    codex: {
        id: 'codex',
        label: 'OpenAI Codex CLI',
        defaultBinary: 'codex',
        defaultModel: 'gpt-5-codex',
        promptVia: 'stdin',
        outputFormat: 'text',
        buildArgs: (model) => ['exec', '--model', model],
    },
    ollama: {
        id: 'ollama',
        label: 'Ollama (local)',
        defaultBinary: 'ollama',
        defaultModel: 'llama3',
        promptVia: 'stdin',
        outputFormat: 'text',
        buildArgs: (model) => ['run', model],
    },
};

function resolveProvider(id: string | undefined): ProviderSpec {
    return PROVIDERS[id ?? 'claude'] ?? PROVIDERS.claude;
}

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

class CLIExecutor {
    private binaryPath: string | null = null;
    private debugMode: boolean;
    private spec: ProviderSpec;
    private model: string;

    constructor(spec: ProviderSpec, model: string, debugMode: boolean = false) {
        this.spec = spec;
        this.model = model;
        this.debugMode = debugMode;
        if (this.debugMode) {
            outputChannel.appendLine(
                `[DEBUG] CLIExecutor initialized: provider=${spec.id} model=${model}`,
            );
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

    async detectBinaryPath(customPath?: string): Promise<string> {
        const binaryName = this.spec.defaultBinary;
        this.log(`\n=== ${binaryName.toUpperCase()} PATH DETECTION START ===`);

        if (customPath && customPath.trim() !== '') {
            const trimmed = customPath.trim();
            this.log(`[CUSTOM PATH] Checking: ${trimmed}`);

            if (!(await this.isExecutableFile(trimmed))) {
                throw new Error(`Custom CLI path is not a file: ${trimmed}`);
            }
            if (!(await this.probe(trimmed))) {
                throw new Error(`Custom CLI path did not respond to --version: ${trimmed}`);
            }

            this.binaryPath = trimmed;
            this.log(`[CUSTOM PATH] ✓ Set binaryPath to: ${trimmed}`);
            return trimmed;
        }

        const isWindows = process.platform === 'win32';
        const lookupBin = isWindows ? 'where' : 'which';
        try {
            const { stdout } = await runFile(lookupBin, [binaryName], { timeout: 5_000 });
            const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
            if (first && (await this.probe(first))) {
                this.binaryPath = first;
                this.log(`[PATH SEARCH] ✓ Found at: ${first}`);
                return first;
            }
        } catch (error: any) {
            this.log(`[PATH SEARCH] ${lookupBin} failed: ${error.message}`);
        }

        if (!isWindows) {
            for (const shell of ['/bin/zsh', '/bin/bash']) {
                try {
                    const { stdout } = await runFile(shell, ['-l', '-c', `command -v ${binaryName}`], {
                        timeout: 5_000,
                    });
                    const candidate = stdout.trim().split(/\r?\n/).pop()?.trim();
                    if (candidate && (await this.probe(candidate))) {
                        this.binaryPath = candidate;
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
            `/usr/local/bin/${binaryName}`,
            `/usr/bin/${binaryName}`,
            `/opt/homebrew/bin/${binaryName}`,
        ];
        if (home) {
            commonPaths.push(path.join(home, '.local', 'bin', binaryName));

            // Scan NVM directory for any matching binary without using `find`.
            const nvmRoot = path.join(home, '.nvm', 'versions', 'node');
            try {
                const versions = await fs.readdir(nvmRoot);
                for (const version of versions) {
                    commonPaths.unshift(path.join(nvmRoot, version, 'bin', binaryName));
                }
            } catch {
                // No NVM install — fine.
            }
        }

        for (const candidate of commonPaths) {
            if (await this.isExecutableFile(candidate)) {
                if (await this.probe(candidate)) {
                    this.binaryPath = candidate;
                    this.log(`[COMMON PATHS] ✓ Set binaryPath to: ${candidate}`);
                    return candidate;
                }
            }
        }

        if (await this.probe(binaryName)) {
            this.binaryPath = binaryName;
            this.log(`[DIRECT EXEC] ✓ Using "${binaryName}" directly`);
            return binaryName;
        }

        throw new Error(
            `${this.spec.label} CLI ("${binaryName}") not found. Please ensure it is installed and on your PATH, or set "${CONFIG_SECTION}.binaryPath" in the extension settings.`,
        );
    }

    async executeCommand(prompt: string): Promise<string> {
        if (!this.binaryPath) {
            await this.detectBinaryPath();
        }
        if (!this.binaryPath || this.binaryPath.trim() === '') {
            throw new Error('CLI path could not be determined');
        }

        this.log('\n=== EXECUTE COMMAND ===');
        this.log(`[EXECUTE] provider=${this.spec.id} path=${this.binaryPath}`);
        this.log(`[EXECUTE] Prompt length: ${prompt.length} chars`);

        const args = this.spec.buildArgs(this.model);
        const runOptions: { input?: string; timeout: number; maxBuffer: number } = {
            timeout: 120_000,
            maxBuffer: 10 * 1024 * 1024,
        };
        if (this.spec.promptVia === 'stdin') {
            runOptions.input = prompt;
        } else {
            args.push(prompt);
        }

        try {
            const startTime = Date.now();
            const { stdout, stderr } = await runFile(this.binaryPath, args, runOptions);
            const duration = Date.now() - startTime;

            this.log(`[EXECUTE] ✓ Done in ${duration}ms`);
            this.log(`[EXECUTE] stdout: ${stdout.length} chars, stderr: ${stderr.length} chars`);
            if (stderr) {
                this.log(`[EXECUTE] stderr content: ${stderr}`);
            }

            const output = stdout.trim() || stderr.trim();
            if (!output) {
                throw new Error('No output received from the CLI');
            }
            return output;
        } catch (error: any) {
            this.log(`[EXECUTE] ✗ ${error.message}`);
            if (error.code === 'ETIMEDOUT') {
                throw new Error(
                    `${this.spec.label} CLI timed out after 120 seconds. Please check that it is installed and authenticated.`,
                );
            }
            throw new Error(`${this.spec.label} CLI execution failed: ${error.message}`);
        }
    }

    /** Strip preamble/code fences and return the commit message from plain text output. */
    private parseText(output: string): string {
        const cleaned = output.trim()
            .replace(/^```[a-zA-Z]*\n?/, '')
            .replace(/\n?```$/, '')
            .trim();

        const lines = cleaned.split('\n');

        // Prefer slicing from the first conventional-commit line to the end so the
        // body is preserved while any leading log/preamble lines are dropped.
        const startIdx = lines.findIndex((line) =>
            /^(feat|fix|docs|style|refactor|test|chore|build|ci|perf)(\(.+\))?!?:/i.test(line.trim()),
        );
        if (startIdx >= 0) {
            return lines.slice(startIdx).join('\n').trim();
        }

        // No conventional prefix — drop common assistant preamble lines.
        const filtered: string[] = [];
        let started = false;
        for (const line of lines) {
            const lower = line.toLowerCase();
            if (
                !started &&
                (lower.includes('based on') ||
                    lower.includes("here's") ||
                    lower.includes('here is') ||
                    lower.includes('commit message') ||
                    line.trim() === '')
            ) {
                continue;
            }
            started = true;
            filtered.push(line);
        }
        return (filtered.length > 0 ? filtered.join('\n') : cleaned).trim();
    }

    parseResponse(output: string): string {
        if (!output) {
            return '';
        }

        if (this.spec.outputFormat === 'text') {
            return this.parseText(output);
        }

        // claude-json
        try {
            const parsed = JSON.parse(output);
            this.log(`[PARSE] ✓ JSON parsed. Keys: ${Object.keys(parsed).join(', ')}`);

            if (parsed.result !== undefined && parsed.result !== null) {
                if (parsed.subtype === 'error_during_execution' || parsed.is_error) {
                    throw new Error('CLI returned an error response');
                }

                let finalResult = String(parsed.result).trim();

                const codeBlockMatch = finalResult.match(/```[\s\S]*?\n([\s\S]*?)\n```/);
                if (codeBlockMatch) {
                    finalResult = codeBlockMatch[1].trim();
                } else {
                    finalResult = this.parseText(finalResult);
                }

                return finalResult;
            }

            if (typeof parsed.text === 'string') { return parsed.text.trim(); }
            if (typeof parsed.message === 'string') { return parsed.message; }
            if (typeof parsed.content === 'string') { return parsed.content; }
            if (typeof parsed === 'string') { return parsed; }

            throw new Error('Could not extract commit message from CLI response. Check Output panel for details.');
        } catch (error: any) {
            this.log(`[PARSE] JSON parse failed: ${error.message}. Falling back to plain text.`);
            return this.parseText(output);
        }
    }
}

class CommitMessageGenerator {
    private cliExecutor: CLIExecutor;
    private spec: ProviderSpec;
    private binaryPath: string;
    private config: vscode.WorkspaceConfiguration;
    private debugMode: boolean;

    constructor() {
        this.config = vscode.workspace.getConfiguration(CONFIG_SECTION);
        this.debugMode = this.config.get<boolean>('debugMode') || false;
        this.spec = resolveProvider(this.config.get<string>('provider'));

        const configuredModel = this.config.get<string>('model')?.trim();
        const model = configuredModel || this.spec.defaultModel;

        this.binaryPath = (this.config.get<string>('binaryPath') || '').trim();

        this.cliExecutor = new CLIExecutor(this.spec, model, this.debugMode);
    }

    private log(message: string): void {
        if (this.debugMode) {
            outputChannel.appendLine(message);
        }
    }

    async generateCommitMessage(repositoryPath?: string): Promise<string> {
        try {
            await this.cliExecutor.detectBinaryPath(this.binaryPath || undefined);

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
            if (error.message.includes('not found')) {
                throw new Error(`${error.message} See the Output panel for details.`);
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
        const provider = resolveProvider(cfg.get<string>('provider'));

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
                    title: `Generating commit message with ${provider.label}...`,
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
                `Error: ${error.message}\n\nCheck 'PHRS Smart Commit' in the Output panel for detailed logs.`,
            );
        }
    });

    context.subscriptions.push(createCommitDisposable);
}

export function deactivate() {
    // VS Code disposes the output channel automatically on extension unload.
}
