export type PromptDelivery = 'stdin' | 'arg';
export type OutputFormat = 'claude-json' | 'text';

export interface ProviderSpec {
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

export const PROVIDERS: Record<string, ProviderSpec> = {
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

export function resolveProvider(id: string | undefined): ProviderSpec {
    return PROVIDERS[id ?? 'claude'] ?? PROVIDERS.claude;
}
