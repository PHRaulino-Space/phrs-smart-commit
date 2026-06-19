import { execFile } from 'child_process';

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

export type ExecResult = { stdout: string; stderr: string };

export interface RunOptions {
    cwd?: string;
    timeoutMs?: number;
    input?: string;
    maxBuffer?: number;
}

export type CommandFailure = 'timeout' | 'maxBuffer' | 'spawn';

/** Normalised failure from {@link runFile}, so callers can react to *why* it failed. */
export class CommandError extends Error {
    constructor(
        message: string,
        readonly reason: CommandFailure,
        readonly cause?: NodeJS.ErrnoException,
    ) {
        super(message);
        this.name = 'CommandError';
    }
}

/**
 * Run a binary directly (never through a shell), optionally feeding `input` on
 * stdin. The candidate path is passed as argv[0], so shell metacharacters in it
 * cannot lead to command injection.
 */
export function runFile(file: string, args: string[], options: RunOptions = {}): Promise<ExecResult> {
    return new Promise<ExecResult>((resolve, reject) => {
        const child = execFile(
            file,
            args,
            {
                cwd: options.cwd,
                timeout: options.timeoutMs,
                maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
                shell: false,
            },
            (error, stdout, stderr) => {
                const out = String(stdout);
                const err = String(stderr);

                if (!error) {
                    resolve({ stdout: out, stderr: err });
                    return;
                }

                const nodeError = error as NodeJS.ErrnoException & { killed?: boolean };

                // The `timeout` option kills the child (SIGTERM) rather than setting a
                // dedicated code, so detect it via `killed` and fail — never return the
                // partial output a hung process may have emitted.
                if (nodeError.killed) {
                    reject(new CommandError('Process timed out', 'timeout', nodeError));
                    return;
                }
                if (nodeError.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
                    reject(new CommandError('Process output exceeded the buffer limit', 'maxBuffer', nodeError));
                    return;
                }

                // A genuine non-zero exit that still produced output is acceptable: some
                // CLIs print their result and exit non-zero (e.g. with warnings).
                if (typeof nodeError.code === 'number' && (out || err)) {
                    resolve({ stdout: out, stderr: err });
                    return;
                }

                reject(new CommandError(nodeError.message, 'spawn', nodeError));
            },
        );

        const stdin = child.stdin;
        if (stdin) {
            // If the child never reads stdin (or exits early) the pipe is closed on us
            // and the write fails with EPIPE. Swallow it — the execFile callback above
            // reports the real outcome; an unhandled 'error' here would crash the host.
            stdin.on('error', () => undefined);
            stdin.end(options.input ?? '');
        }
    });
}
