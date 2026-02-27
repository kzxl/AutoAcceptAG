# Auto Accept AG

Auto-accept terminal commands, file edits, and agent prompts for **Antigravity** and **GitHub Copilot** in VS Code.

Stop babysitting your AI agents — let them run hands-free.

## Features

- ✅ **Auto-accept terminal commands** — No more clicking "Accept" every time
- ✅ **Auto-accept file edits** — Agent suggestions applied automatically
- ✅ **Provider toggles** — Enable/disable Antigravity and Copilot independently
- ✅ **Status bar indicator** — See what's active at a glance
- ✅ **Command discovery** — Auto-detects available accept commands
- ✅ **Configurable polling** — Adjust check frequency (default: 300ms)

## Quick Start

1. Install the `.vsix` file:
   ```
   code --install-extension auto-accept-ag-0.1.0.vsix
   ```
2. Reload VS Code (`Ctrl+Shift+P` → `Reload Window`)
3. Done — Auto Accept activates automatically

Check the **status bar** (bottom-right) for `Auto Accept: ON [Antigravity, Copilot]`.

## Settings

Open VS Code Settings (`Ctrl+,`) and search for `autoAcceptAG`:

| Setting | Default | Description |
|---------|---------|-------------|
| `autoAcceptAG.enabled` | `true` | Master toggle on/off |
| `autoAcceptAG.providers.antigravity` | `true` | Enable for Antigravity |
| `autoAcceptAG.providers.copilot` | `true` | Enable for GitHub Copilot |
| `autoAcceptAG.pollingInterval` | `300` | Polling interval (ms) |
| `autoAcceptAG.commandPatterns` | `[...]` | Keywords to match accept commands |

## Keyboard Shortcut

`Ctrl+Shift+F10` — Toggle Auto Accept on/off

## Commands

- `Auto Accept AG: Toggle On/Off` — Quick toggle
- `Auto Accept AG: Discover Accept Commands` — List all detected accept commands (Output panel)

## Supported Commands

### Antigravity
```
antigravity.agent.acceptAgentStep
antigravity.command.accept
antigravity.prioritized.agentAcceptAllInFile
antigravity.prioritized.agentAcceptFocusedHunk
antigravity.prioritized.supercompleteAccept
antigravity.terminalCommand.accept
antigravity.acceptCompletion
antigravity.prioritized.terminalSuggestion.accept
```

### GitHub Copilot
```
github.copilot.terminal.acceptCommand
github.copilot.chat.acceptTerminalCommand
github.copilot.acceptSuggestion
```

### VS Code Built-in
```
workbench.action.chat.acceptTerminalCommand
workbench.action.chat.runInTerminal
chat.action.acceptCommand
workbench.action.terminal.chat.acceptCommand
```

## How It Works

The extension polls at a configurable interval and executes known accept commands via `vscode.commands.executeCommand()`. Commands that aren't available at the moment silently fail — this is by design.

On startup, it also **discovers** additional accept-related commands by pattern-matching against all registered VS Code commands.

## Credits

Command list referenced from [Munkhin/auto-accept-agent](https://github.com/Munkhin/auto-accept-agent).

## License

MIT
