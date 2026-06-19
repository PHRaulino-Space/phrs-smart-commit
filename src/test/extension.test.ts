import * as assert from 'assert';

import { CLIExecutor } from '../cli-executor';
import { buildCommitPrompt, buildDiffArgs, EXCLUDED_PATHSPECS } from '../commit-generator';
import { DEFAULT_LANGUAGE, LANGUAGES, resolveLanguage } from '../languages';
import { CommandError, runFile } from '../process';
import { PROVIDERS } from '../providers';

const NODE = process.execPath;

/** Run inline JS in a child node process. */
function node(script: string) {
    return ['-e', script];
}

suite('runFile', () => {
    test('returns stdout on success', async () => {
        const { stdout } = await runFile(NODE, node('process.stdout.write("ok")'));
        assert.strictEqual(stdout, 'ok');
    });

    test('pipes input to stdin', async () => {
        const { stdout } = await runFile(
            NODE,
            node('process.stdin.pipe(process.stdout)'),
            { input: 'hello-stdin' },
        );
        assert.strictEqual(stdout, 'hello-stdin');
    });

    test('resolves on non-zero exit when there is output', async () => {
        const { stdout } = await runFile(NODE, node('process.stdout.write("partial"); process.exit(3)'));
        assert.strictEqual(stdout, 'partial');
    });

    test('rejects with reason "timeout" when the process is killed by the timeout', async () => {
        await assert.rejects(
            runFile(NODE, node('setTimeout(() => {}, 10000)'), { timeoutMs: 200 }),
            (error: unknown) => error instanceof CommandError && error.reason === 'timeout',
        );
    });

    test('rejects with reason "maxBuffer" when output exceeds the limit', async () => {
        await assert.rejects(
            runFile(NODE, node('process.stdout.write("a".repeat(5000))'), { maxBuffer: 100 }),
            (error: unknown) => error instanceof CommandError && error.reason === 'maxBuffer',
        );
    });

    test('rejects with reason "spawn" when the binary does not exist', async () => {
        await assert.rejects(
            runFile('definitely-not-a-real-binary-xyz', []),
            (error: unknown) => error instanceof CommandError && error.reason === 'spawn',
        );
    });

    test('does not crash when the child closes stdin early while a large input is written (EPIPE)', async () => {
        // The child exits immediately without reading stdin; writing 1 MB triggers
        // EPIPE on the stdin stream, which must be swallowed rather than thrown.
        const { stdout } = await runFile(
            NODE,
            node('process.exit(0)'),
            { input: 'x'.repeat(1024 * 1024) },
        );
        assert.strictEqual(stdout, '');
    });
});

suite('CLIExecutor.parseResponse', () => {
    const text = new CLIExecutor(PROVIDERS.gemini, 'm');
    const claude = new CLIExecutor(PROVIDERS.claude, 'm');

    test('returns empty string for empty output', () => {
        assert.strictEqual(text.parseResponse(''), '');
    });

    test('text: keeps a conventional commit message including its body', () => {
        const out = text.parseResponse('feat: add thing\n\nMore details here.');
        assert.strictEqual(out, 'feat: add thing\n\nMore details here.');
    });

    test('text: drops assistant preamble before the message', () => {
        const out = text.parseResponse("Here's the commit message:\n\nfix: handle null path");
        assert.strictEqual(out, 'fix: handle null path');
    });

    test('text: strips surrounding code fences', () => {
        const out = text.parseResponse('```\nchore: bump deps\n```');
        assert.strictEqual(out, 'chore: bump deps');
    });

    test('claude-json: extracts the result field', () => {
        const out = claude.parseResponse(JSON.stringify({ result: 'feat: parse json' }));
        assert.strictEqual(out, 'feat: parse json');
    });

    test('claude-json: extracts a fenced commit message from the result', () => {
        const out = claude.parseResponse(JSON.stringify({ result: '```\nfix: fenced\n```' }));
        assert.strictEqual(out, 'fix: fenced');
    });

    test('claude-json: throws on an error response', () => {
        assert.throws(() => claude.parseResponse(JSON.stringify({ result: 'x', is_error: true })));
    });

    test('claude-json: falls back to text parsing on invalid JSON', () => {
        const out = claude.parseResponse('feat: not actually json');
        assert.strictEqual(out, 'feat: not actually json');
    });
});

suite('languages', () => {
    test('resolves a known code to its full name', () => {
        assert.strictEqual(resolveLanguage('pt-br'), 'Brazilian Portuguese');
        assert.strictEqual(resolveLanguage('en-us'), 'English');
    });

    test('falls back to the default for unknown or missing codes', () => {
        assert.strictEqual(resolveLanguage(undefined), LANGUAGES[DEFAULT_LANGUAGE]);
        assert.strictEqual(resolveLanguage('xx-yy'), LANGUAGES[DEFAULT_LANGUAGE]);
    });
});

suite('buildCommitPrompt', () => {
    test('injects the diff and the language', () => {
        const prompt = buildCommitPrompt('my diff body', 'Brazilian Portuguese');
        assert.ok(prompt.includes('my diff body'));
        assert.ok(prompt.includes('write the commit message in Brazilian Portuguese'));
        assert.ok(!prompt.includes('{{diff}}'));
        assert.ok(!prompt.includes('{{language}}'));
    });

    test('wraps the diff in untrusted-data delimiters with an injection guard', () => {
        const prompt = buildCommitPrompt('feat: x', 'English');
        assert.ok(prompt.includes('<git-diff>') && prompt.includes('</git-diff>'));
        assert.ok(prompt.includes('UNTRUSTED DATA'));
    });

    test('inserts $-sequences from the diff literally', () => {
        // `$&`, `$1` etc. are special in String.replace patterns; they must survive verbatim.
        const diff = 'const x = "$& and $1 and $$";';
        const prompt = buildCommitPrompt(diff, 'English');
        assert.ok(prompt.includes(diff));
    });
});

suite('buildDiffArgs', () => {
    test('plain unstaged diff has no --cached/--stat and no excludes', () => {
        assert.deepStrictEqual(buildDiffArgs(false, false, false), ['diff']);
    });

    test('staged toggles --cached, stat toggles --stat', () => {
        assert.deepStrictEqual(buildDiffArgs(true, false, false), ['diff', '--cached']);
        assert.deepStrictEqual(buildDiffArgs(true, true, false), ['diff', '--cached', '--stat']);
    });

    test('exclude appends the noise-filtering pathspecs after a "--" separator', () => {
        const args = buildDiffArgs(true, false, true);
        const sep = args.indexOf('--');
        assert.ok(sep >= 0, 'should contain a -- separator');
        assert.strictEqual(args[sep + 1], '.');
        for (const spec of EXCLUDED_PATHSPECS) {
            assert.ok(args.includes(spec), `missing exclude pathspec: ${spec}`);
        }
    });
});
