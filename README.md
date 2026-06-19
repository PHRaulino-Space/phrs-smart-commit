# PHRS Smart Commit

> **Hardened, multi-provider fork** of [juanlb/claude-commit](https://github.com/juanlb/claude-commit) with the security fixes listed in [Security hardening](#security-hardening).

**Already paying for an AI CLI? Get the commit message button you deserve — with the provider you already have.**

A VS Code extension that brings the ✨ sparkle button to your Git panel, powered by the AI CLI **of your choice**: Claude Code, Gemini CLI, OpenAI Codex CLI, or a local model via Ollama. Generate intelligent commit messages without paying for yet another AI service.

![Sparkle button in Git panel](screenshots/sparkle-button-demo.png)

## Why PHRS Smart Commit?

You're already invested in some AI CLI — Claude Code, Gemini, Codex, or a local model you run yourself. Why pay for Copilot or Cursor just for commit message generation? This extension reuses the CLI you already have, authenticated the way you already authenticate it.

**Zero additional cost. Zero API keys stored. Just works.**

## Supported providers

| Provider | Setting value | CLI binary | Default model | Notes |
|----------|---------------|-----------|---------------|-------|
| Claude Code | `claude` | `claude` | `sonnet` | Default |
| Gemini CLI | `gemini` | `gemini` | `gemini-2.5-flash` | |
| OpenAI Codex CLI | `codex` | `codex` | `gpt-5-codex` | |
| Ollama (local) | `ollama` | `ollama` | `llama3` | Runs a model locally |

The prompt (your full `git diff` plus instructions) is sent to the selected CLI over **stdin**, and the response is parsed back into the commit message box. No shell is invoked — the binary and its arguments are executed directly (see [Security hardening](#security-hardening)).

## Features

- **One-click commit message generation**: The sparkle button ✨ in VS Code's Git panel
- **Provider of your choice**: Claude, Gemini, Codex, or a local Ollama model — switch with one setting
- **Uses your existing CLI**: No extra API keys or subscriptions managed by the extension
- **Context-aware**: Reads your staged (or unstaged) diff to write conventional commit messages
- **Seamless VS Code integration**: Works directly with the built-in Git interface

## Requirements

- VS Code 1.103.0 or higher
- One of the supported AI CLIs installed, on your `PATH`, and authenticated
- Git repository initialized in your workspace
- For cloud providers (Claude/Gemini/Codex): an internet connection

## Installation

1. Install the extension from the VS Code Marketplace
2. Install and authenticate the CLI you want to use (e.g. `claude`, `gemini`, `codex`, or `ollama`)
3. Set `phrs-smart-commit.provider` if you don't want the default (`claude`)
4. Open a project with a Git repository and look for the sparkle ✨ button in your Git panel

## How to Use

1. Make your code changes
2. Stage your changes (optional — works with unstaged changes too)
3. Click the sparkle ✨ button next to the commit message input
4. Review the AI-generated commit message
5. Commit

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `phrs-smart-commit.provider` | `claude` | Which AI CLI generates the message: `claude`, `gemini`, `codex`, or `ollama`. |
| `phrs-smart-commit.model` | _(empty)_ | Model passed to the CLI. Empty uses the provider default (see table above). |
| `phrs-smart-commit.language` | `en-us` | Language for the generated message: `en-us`, `pt-br`, `es`, `fr`, `de`, `it`, `ja`, or `zh-cn`. Conventional commit keywords (`feat`, `fix`, …) always stay in English. |
| `phrs-smart-commit.binaryPath` | _(empty)_ | Custom path to the CLI executable. Auto-detects from `PATH` by default. |
| `phrs-smart-commit.debugMode` | `false` | Enable debug output (shows the executed command in the Output panel). |

## Configuration Examples

### Use Gemini with a specific model
```json
{
    "phrs-smart-commit.provider": "gemini",
    "phrs-smart-commit.model": "gemini-2.5-pro"
}
```

### Use a local model via Ollama
```json
{
    "phrs-smart-commit.provider": "ollama",
    "phrs-smart-commit.model": "qwen2.5-coder"
}
```

### Generate messages in Brazilian Portuguese
```json
{
    "phrs-smart-commit.language": "pt-br"
}
```

### Use Claude with a custom binary path
```json
{
    "phrs-smart-commit.provider": "claude",
    "phrs-smart-commit.binaryPath": "/usr/local/bin/claude"
}
```

### Debug mode for troubleshooting
```json
{
    "phrs-smart-commit.debugMode": true
}
```

## Troubleshooting

### CLI not found

If the extension can't find your CLI:

1. **Check it's installed**: run in a terminal, e.g.
   ```bash
   which claude   # or: which gemini / which codex / which ollama
   ```
2. **Set a custom path in VS Code**:
   - Open VS Code Settings (Cmd+,)
   - Search for "phrs-smart-commit"
   - In **Binary Path**, enter the full path from step 1
3. **Enable Debug Mode**:
   - Enable "Debug Mode" in settings
   - Open the Output panel (View → Output)
   - Select **"PHRS Smart Commit"** from the dropdown
   - Try generating a commit message and check the logs
4. **Common issues**:
   - **NVM users**: VS Code might not see NVM paths — use the custom path setting
   - **macOS / zsh**: paths can differ between terminal and VS Code
   - **Authentication**: make sure the selected CLI is logged in (e.g. `claude setup-token`, `gemini` login, `codex login`)

### No commit message generated
1. Ensure you have changes in your repository
2. Check the selected CLI is properly installed and authenticated
3. Enable debug mode to see the actual command being executed

### A provider's flags don't match your CLI version
The provider invocations are best-effort defaults (`claude --print --model … --output-format json`, `gemini -m …`, `codex exec --model …`, `ollama run …`, all over stdin). If your CLI version expects something different, enable debug mode to see the exact command, then open an issue.

## Privacy & Security

- Your code changes are processed locally through the selected CLI
- No API keys are stored or transmitted by this extension
- Authentication is handled by your existing CLI setup
- Code is only sent to a provider's servers through your own authenticated CLI session (local providers like Ollama send nothing off-machine)

> ⚠️ **Heads-up:** the **entire `git diff`** is sent to the CLI as the prompt. If you accidentally staged a `.env`, key file, or secret-bearing line, it will be included. Check `git diff --cached` before clicking the sparkle button.

## Security hardening

This fork addresses the following issues present in upstream `juanlb/claude-commit` v1.0.1:

- **Shell command injection via the CLI path** — upstream interpolated the configured Claude CLI path straight into a `bash -c` pipeline (`echo … | base64 -d | ${this.claudePath}`). A workspace-scoped `.vscode/settings.json` setting the path to `claude; rm -rf ~` would execute on the user's machine. This fork uses `execFile` with `shell: false`, passing the path as `argv[0]` and the prompt via `stdin`. Provider arguments come from fixed tables, never from interpolated strings.
- **Untrusted-workspace exposure** — upstream did not declare `capabilities.untrustedWorkspaces`. This fork sets `supported: false`, so the extension is disabled in untrusted workspaces. The `binaryPath` setting is also marked `machine-overridable`, blocking workspace-level override.
- **Removed `--dangerously-skip-permissions`** — upstream passed this flag on every Claude invocation. It is unnecessary for generating a commit message and bypasses Claude Code's permission prompts.
- **Removed unsafe shell helpers** — `find ${home}/.nvm …` and other interpolated commands have been replaced with `fs.readdir` scans. The broken `${process.env.HOME}/.nvm/.../bin` glob in `PATH` (which never expanded) was removed.
- **Removed fragile internal API access** — the upstream `(uri as any).E?.fsPath` referenced an obfuscated VS Code internal that would break on minor updates; replaced with the documented `uri.fsPath`.

## Release Notes

### 1.2.0 (fork)
- **Multi-provider support**: choose Claude, Gemini, Codex, or a local model via Ollama
- New settings: `phrs-smart-commit.provider`, `phrs-smart-commit.model`, and `phrs-smart-commit.language`
- Reworked prompt aligned with the Conventional Commits spec (imperative mood, optional scope/body)
- Renamed the extension to **PHRS Smart Commit** (`phrs-smart-commit`); command and config keys updated accordingly
- `claudePath` setting replaced by the provider-agnostic `binaryPath`
- Hardened CLI executor (timeout/buffer/EPIPE handling)

### 1.1.0 (fork)
- Security hardening (see [Security hardening](#security-hardening))
- Renamed package to `phrs-claude-commit` and command/config keys accordingly
- Declared `capabilities.untrustedWorkspaces.supported = false`

### 1.0.1
- Streamlined configuration – removed unnecessary options for dead-simple operation
- Enhanced README to clarify value proposition for Claude Code users

### 1.0.0
- Complete refactor to use Claude CLI instead of Anthropic API
- Simplified configuration
- Hardcoded to use Sonnet model and conventional commit format
- Improved debug logging that only runs when debug mode is enabled

## Contributing

Found a bug or have a feature request? Please open an issue on the [fork's repository](https://github.com/PHRaulino-Space/phrs-smart-commit).

## License

MIT License - see LICENSE file for details.

---

**Stop paying twice for AI commit messages. Use the CLI you've already got — now with the commit button. ✨**
