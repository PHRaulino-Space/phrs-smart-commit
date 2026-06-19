# Change Log

## [1.2.0]
- **Multi-provider support**: choose Claude, Gemini, Codex, or a local model via Ollama with the `phrs-smart-commit.provider` setting.
- New `phrs-smart-commit.model` setting to pick the model per provider (empty = provider default).
- New `phrs-smart-commit.language` setting to choose the commit message language (`en-us`, `pt-br`, `es`, `fr`, `de`, `it`, `ja`, `zh-cn`; default `en-us`). Conventional commit keywords stay in English.
- Reworked the generation prompt to follow the Conventional Commits spec more closely (imperative mood, optional scope, optional body for non-trivial changes).
- Renamed the extension to **PHRS Smart Commit** (`phrs-smart-commit`); command and configuration keys updated accordingly.
- Replaced `claudePath` with the provider-agnostic `binaryPath` setting.
- Hardened the CLI executor: proper timeout/buffer-overflow detection and EPIPE handling on stdin, so a hung or early-exiting CLI no longer crashes the extension or returns truncated output.

## [1.1.0]
- Security hardening of the upstream `juanlb/claude-commit`: removed shell command injection via the CLI path, declared `capabilities.untrustedWorkspaces.supported = false`, removed `--dangerously-skip-permissions` and unsafe shell helpers.
- Renamed package to `phrs-claude-commit`.

## [1.0.1]
- Streamlined configuration.

## [1.0.0]
- Refactored to use the Claude CLI instead of the Anthropic API.
