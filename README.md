# PHRS Claude Commit

> **Hardened fork** of [juanlb/claude-commit](https://github.com/juanlb/claude-commit) with the security fixes listed in [Security hardening](#security-hardening).

**Already using Claude Code? Get the commit message button you deserve – at no extra cost.**

A VS Code extension that brings the ✨ sparkle button to your Git panel, powered by the Claude CLI you already have. Generate intelligent commit messages without paying for additional AI services.

![Sparkle button in Git panel](screenshots/sparkle-button-demo.png)

## Why Claude Commit?

You're already investing in Claude Code – whether it's Pro, Max ×5, or Max ×10. Why pay for Copilot or Cursor just for commit message generation? This extension leverages your existing Claude subscription to bring the same AI-powered commit message functionality directly to VS Code.

**Zero additional cost. Zero complexity. Just works.**

## Features

- **One-click commit message generation**: The sparkle button ✨ you know and love, right in VS Code's Git panel
- **Powered by your Claude CLI**: Uses your existing Claude installation – no extra API keys or subscriptions
- **Context-aware analysis**: Understands your git diff to generate meaningful, conventional commit messages
- **Dead simple**: No configuration needed – install and go
- **Seamless VS Code integration**: Works directly with the built-in Git interface

## Requirements

- VS Code 1.103.0 or higher
- Claude CLI installed and authenticated (comes with your Claude Code subscription)
- Git repository initialized in your workspace
- Internet connection for AI generation

## Installation

1. Install the extension from the VS Code Marketplace
2. Ensure Claude CLI is installed and available in your system PATH
3. Open a project with a Git repository
4. Look for the sparkle ✨ button in your Git panel

## How to Use

1. Make your code changes
2. Stage your changes (optional – works with unstaged changes too)
3. Click the sparkle ✨ button next to the commit message input
4. Review the AI-generated commit message
5. Commit

That's it. No configuration, no setup wizards, no complexity.

## Extension Settings

This extension keeps it simple with just two optional settings:

* `phrs-claude-commit.claudePath`: Custom path to Claude CLI executable (auto-detects by default)
* `phrs-claude-commit.debugMode`: Enable debug output for troubleshooting

## Configuration Examples

### Using a custom Claude path
```json
{
    "phrs-claude-commit.claudePath": "/usr/local/bin/claude"
}
```

### Debug mode for troubleshooting
```json
{
    "phrs-claude-commit.debugMode": true
}
```

## Troubleshooting

### Claude CLI not found

If the extension can't find Claude CLI:

1. **Check Claude is installed**: Run in terminal:
   ```bash
   which claude
   ```
   This should show the path to Claude (e.g., `/Users/you/.nvm/versions/node/v22.13.0/bin/claude`)

2. **Set custom path in VS Code**:
   - Open VS Code Settings (Cmd+,)
   - Search for "phrs-claude-commit"
   - In "Claude Path", enter the full path from step 1

3. **Enable Debug Mode**:
   - Enable "Debug Mode" in settings
   - Open Output panel (View → Output)
   - Select "PHRS Claude Commit" from dropdown
   - Try generating a commit message and check logs

4. **Common issues**:
   - **NVM users**: VS Code might not see NVM paths – use the custom path setting
   - **macOS**: If using zsh, paths might differ between terminal and VS Code
   - **Authentication**: Ensure Claude CLI is authenticated by running `claude setup-token` in terminal

### No commit message generated
1. Ensure you have changes in your repository
2. Check that Claude CLI is properly authenticated
3. Enable debug mode to see the actual commands being executed

## Privacy & Security

- Your code changes are processed locally through Claude CLI
- No API keys are stored or transmitted by this extension
- Authentication is handled by your existing Claude CLI setup
- Code is only sent to Claude's servers through your authenticated CLI session

> ⚠️ **Heads-up:** the **entire `git diff`** is sent to Claude as the prompt. If you accidentally staged a `.env`, key file, or secret-bearing line, it will be transmitted. Check `git diff --cached` before clicking the sparkle button.

## Security hardening

This fork addresses the following issues present in upstream `juanlb/claude-commit` v1.0.1:

- **Shell command injection via `claudePath`** — upstream interpolated the configured Claude CLI path straight into a `bash -c` pipeline (`echo … | base64 -d | ${this.claudePath}`). A workspace-scoped `.vscode/settings.json` setting `phrs-claude-commit.claudePath` to `claude; rm -rf ~` would execute on the user's machine. This fork uses `execFile` with `shell: false`, passing the path as `argv[0]` and the prompt via `stdin`.
- **Untrusted-workspace exposure** — upstream did not declare `capabilities.untrustedWorkspaces`. This fork sets `supported: false`, so the extension is disabled in untrusted workspaces. The `claudePath` setting is also marked `machine-overridable`, blocking workspace-level override.
- **Removed `--dangerously-skip-permissions`** — upstream passed this flag on every Claude invocation. It is unnecessary for generating a commit message and bypasses Claude Code's permission prompts.
- **Removed unsafe shell helpers** — `find ${home}/.nvm …` and other interpolated commands have been replaced with `fs.readdir` scans. The broken `${process.env.HOME}/.nvm/.../bin` glob in `PATH` (which never expanded) was removed.
- **Removed fragile internal API access** — the upstream `(uri as any).E?.fsPath` referenced an obfuscated VS Code internal that would break on minor updates; replaced with the documented `uri.fsPath`.

## Release Notes

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
- New name: Claude Commit (formerly Claude Code AI Commit Message Button)

## Contributing

Found a bug or have a feature request? Please open an issue on the [fork's repository](https://github.com/PHRaulino-Space/phrs-claude-commit).

## License

MIT License - see LICENSE file for details.

---

**Stop paying twice for AI commit messages. You've got Claude Code – now get the commit button. ✨**