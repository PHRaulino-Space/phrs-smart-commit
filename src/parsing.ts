import type { ProviderSpec } from './providers';

type Log = (message: string) => void;
const noop: Log = () => undefined;

/** Conventional-commit types we use to locate the start of a commit message. */
const CONVENTIONAL_TYPES = 'feat|fix|docs|style|refactor|test|chore|build|ci|perf';
const CONVENTIONAL_COMMIT_RE = new RegExp(`^(${CONVENTIONAL_TYPES})(\\(.+\\))?!?:`, 'i');

/** Turn raw CLI output into a clean commit message, per the provider's output format. */
export function parseResponse(spec: ProviderSpec, output: string, log: Log = noop): string {
    if (!output) {
        return '';
    }
    return spec.outputFormat === 'claude-json'
        ? parseClaudeJson(output, log)
        : parseText(output);
}

/** Parse Claude's `--output-format json` envelope, falling back to text parsing. */
function parseClaudeJson(output: string, log: Log): string {
    let parsed: any;
    try {
        parsed = JSON.parse(output);
    } catch (error: any) {
        log(`[PARSE] JSON parse failed: ${error.message}. Falling back to plain text.`);
        return parseText(output);
    }

    log(`[PARSE] ✓ JSON parsed. Keys: ${Object.keys(parsed).join(', ')}`);

    if (parsed.result !== undefined && parsed.result !== null) {
        if (parsed.subtype === 'error_during_execution' || parsed.is_error) {
            throw new Error('CLI returned an error response');
        }
        const result = String(parsed.result).trim();
        const codeBlock = result.match(/```[\s\S]*?\n([\s\S]*?)\n```/);
        return codeBlock ? codeBlock[1].trim() : parseText(result);
    }

    if (typeof parsed.text === 'string') { return parsed.text.trim(); }
    if (typeof parsed.message === 'string') { return parsed.message; }
    if (typeof parsed.content === 'string') { return parsed.content; }
    if (typeof parsed === 'string') { return parsed; }

    throw new Error('Could not extract commit message from CLI response. Check Output panel for details.');
}

/** Strip code fences and assistant preamble, returning the commit message. */
function parseText(output: string): string {
    const cleaned = output.trim()
        .replace(/^```[a-zA-Z]*\n?/, '')
        .replace(/\n?```$/, '')
        .trim();

    const lines = cleaned.split('\n');

    // Prefer slicing from the first conventional-commit line to the end, so the
    // body is preserved while any leading log/preamble lines are dropped.
    const startIdx = lines.findIndex((line) => CONVENTIONAL_COMMIT_RE.test(line.trim()));
    if (startIdx >= 0) {
        return lines.slice(startIdx).join('\n').trim();
    }

    // No conventional prefix — drop common assistant preamble lines.
    const filtered: string[] = [];
    let started = false;
    for (const line of lines) {
        if (!started && isPreambleLine(line)) {
            continue;
        }
        started = true;
        filtered.push(line);
    }
    return (filtered.length > 0 ? filtered.join('\n') : cleaned).trim();
}

function isPreambleLine(line: string): boolean {
    const lower = line.toLowerCase();
    return (
        line.trim() === '' ||
        lower.includes('based on') ||
        lower.includes("here's") ||
        lower.includes('here is') ||
        lower.includes('commit message')
    );
}
