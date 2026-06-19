# Change Log

## [1.2.0]
- **Multi-provider support**: choose Claude, Gemini, Codex, or a local model via Ollama with the `phrs-smart-commit.provider` setting.
- New `phrs-smart-commit.model` setting to pick the model per provider (empty = provider default).
- Renamed the extension to **PHRS Smart Commit** (`phrs-smart-commit`); command and configuration keys updated accordingly.
- Replaced `claudePath` with the provider-agnostic `binaryPath` setting.

## [1.1.0]
- Security hardening of the upstream `juanlb/claude-commit`: removed shell command injection via the CLI path, declared `capabilities.untrustedWorkspaces.supported = false`, removed `--dangerously-skip-permissions` and unsafe shell helpers.
- Renamed package to `phrs-claude-commit`.

## [1.0.1]
- Streamlined configuration.

## [1.0.0]
- Refactored to use the Claude CLI instead of the Anthropic API.
