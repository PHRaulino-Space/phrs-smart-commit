import * as fs from 'fs/promises';
import * as path from 'path';

import { CONFIG_SECTION } from './config';
import type { Logger } from './log';
import { parseResponse } from './parsing';
import { CommandError, runFile, RunOptions } from './process';
import type { ProviderSpec } from './providers';

const EXECUTE_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 10_000;
const LOOKUP_TIMEOUT_MS = 5_000;

export class CLIExecutor {
    private binaryPath: string | null = null;

    constructor(
        private readonly spec: ProviderSpec,
        private readonly model: string,
        private readonly log: Logger = () => undefined,
    ) {
        this.log(`[DEBUG] CLIExecutor initialized: provider=${spec.id} model=${model}`);
    }

    private async fileExists(candidate: string): Promise<boolean> {
        try {
            return (await fs.stat(candidate)).isFile();
        } catch {
            return false;
        }
    }

    /**
     * Probe a candidate with `--version` (no shell). Returns whether it responded,
     * which doubles as an "is this a working CLI?" check.
     */
    private async probe(candidate: string): Promise<boolean> {
        try {
            await runFile(candidate, ['--version'], { timeoutMs: PROBE_TIMEOUT_MS });
            return true;
        } catch (error: any) {
            this.log(`[PROBE] ${candidate} failed: ${error.message}`);
            return false;
        }
    }

    async detectBinaryPath(customPath?: string): Promise<string> {
        const trimmedCustom = customPath?.trim();
        if (trimmedCustom) {
            this.binaryPath = await this.resolveCustomPath(trimmedCustom);
            return this.binaryPath;
        }
        if (this.binaryPath) {
            return this.binaryPath;
        }

        const binaryName = this.spec.defaultBinary;
        this.log(`\n=== ${binaryName.toUpperCase()} PATH DETECTION START ===`);

        const found =
            (await this.findOnPath(binaryName)) ??
            (await this.findViaLoginShell(binaryName)) ??
            (await this.findInCommonPaths(binaryName)) ??
            ((await this.probe(binaryName)) ? binaryName : null);

        if (!found) {
            throw new Error(
                `${this.spec.label} CLI ("${binaryName}") not found. Please ensure it is installed and on your PATH, or set "${CONFIG_SECTION}.binaryPath" in the extension settings.`,
            );
        }

        this.binaryPath = found;
        this.log(`[DETECT] ✓ Using: ${found}`);
        return found;
    }

    /** Validate and probe a user-supplied path; throws if it is unusable. */
    private async resolveCustomPath(candidate: string): Promise<string> {
        this.log(`[CUSTOM PATH] Checking: ${candidate}`);
        if (!(await this.fileExists(candidate))) {
            throw new Error(`Custom CLI path is not a file: ${candidate}`);
        }
        if (!(await this.probe(candidate))) {
            throw new Error(`Custom CLI path did not respond to --version: ${candidate}`);
        }
        return candidate;
    }

    /** Locate the binary via `which` (POSIX) / `where` (Windows). */
    private async findOnPath(binaryName: string): Promise<string | null> {
        const lookup = process.platform === 'win32' ? 'where' : 'which';
        try {
            const { stdout } = await runFile(lookup, [binaryName], { timeoutMs: LOOKUP_TIMEOUT_MS });
            const candidate = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
            if (candidate && (await this.probe(candidate))) {
                this.log(`[PATH SEARCH] ✓ ${candidate}`);
                return candidate;
            }
        } catch (error: any) {
            this.log(`[PATH SEARCH] ${lookup} failed: ${error.message}`);
        }
        return null;
    }

    /** Ask a login shell, which picks up nvm/asdf shims that VS Code's PATH may miss. */
    private async findViaLoginShell(binaryName: string): Promise<string | null> {
        if (process.platform === 'win32') {
            return null;
        }
        for (const shell of ['/bin/zsh', '/bin/bash']) {
            try {
                const { stdout } = await runFile(shell, ['-l', '-c', `command -v ${binaryName}`], {
                    timeoutMs: LOOKUP_TIMEOUT_MS,
                });
                const candidate = stdout.trim().split(/\r?\n/).pop()?.trim();
                if (candidate && (await this.probe(candidate))) {
                    this.log(`[LOGIN SHELL] ✓ via ${shell}: ${candidate}`);
                    return candidate;
                }
            } catch (error: any) {
                this.log(`[LOGIN SHELL] ${shell} failed: ${error.message}`);
            }
        }
        return null;
    }

    /** Check well-known install locations, including nvm-managed node versions. */
    private async findInCommonPaths(binaryName: string): Promise<string | null> {
        for (const candidate of await this.commonPaths(binaryName)) {
            if ((await this.fileExists(candidate)) && (await this.probe(candidate))) {
                this.log(`[COMMON PATHS] ✓ ${candidate}`);
                return candidate;
            }
        }
        return null;
    }

    private async commonPaths(binaryName: string): Promise<string[]> {
        const paths = [
            `/usr/local/bin/${binaryName}`,
            `/usr/bin/${binaryName}`,
            `/opt/homebrew/bin/${binaryName}`,
        ];

        const home = process.env.HOME || process.env.USERPROFILE || '';
        if (!home) {
            return paths;
        }
        paths.push(path.join(home, '.local', 'bin', binaryName));

        // Prepend any nvm-managed node versions without shelling out to `find`.
        const nvmRoot = path.join(home, '.nvm', 'versions', 'node');
        try {
            for (const version of await fs.readdir(nvmRoot)) {
                paths.unshift(path.join(nvmRoot, version, 'bin', binaryName));
            }
        } catch {
            // No nvm install — fine.
        }
        return paths;
    }

    async executeCommand(prompt: string): Promise<string> {
        const binaryPath = this.binaryPath ?? (await this.detectBinaryPath());

        this.log('\n=== EXECUTE COMMAND ===');
        this.log(`[EXECUTE] provider=${this.spec.id} path=${binaryPath}`);
        this.log(`[EXECUTE] Prompt length: ${prompt.length} chars`);

        const args = this.spec.buildArgs(this.model);
        const runOptions: RunOptions = { timeoutMs: EXECUTE_TIMEOUT_MS };
        if (this.spec.promptVia === 'stdin') {
            runOptions.input = prompt;
        } else {
            args.push(prompt);
        }

        try {
            const startTime = Date.now();
            const { stdout, stderr } = await runFile(binaryPath, args, runOptions);
            this.log(`[EXECUTE] ✓ Done in ${Date.now() - startTime}ms`);
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
            if (error instanceof CommandError && error.reason === 'timeout') {
                throw new Error(
                    `${this.spec.label} CLI timed out after ${EXECUTE_TIMEOUT_MS / 1000} seconds. Please check that it is installed and authenticated.`,
                );
            }
            throw new Error(`${this.spec.label} CLI execution failed: ${error.message}`);
        }
    }

    parseResponse(output: string): string {
        return parseResponse(this.spec, output, this.log);
    }
}
