import * as vscode from 'vscode';

// ─── Provider definitions with their known commands ───
// Commands are split into "safe" (terminal/agent flow only) and "aggressive" (file edits, completions)
// Only safe commands are used by default to prevent unwanted side effects

interface ProviderDef {
    key: string;
    label: string;
    contextKeywords: string[];
    // Safe: only accept terminal commands and agent workflow steps
    safeCommands: string[];
    // Aggressive: accept file edits, completions — can cause jumpy behavior
    aggressiveCommands: string[];
}

const PROVIDERS: ProviderDef[] = [
    {
        key: 'antigravity',
        label: 'Antigravity',
        contextKeywords: ['antigravity'],
        // Safe: ONLY terminal commands — these don't cause navigation or open Agent Manager
        safeCommands: [
            'antigravity.terminalCommand.accept',                // Accept terminal command
            'antigravity.prioritized.terminalSuggestion.accept', // Accept terminal suggestion
        ],
        // Aggressive: these can open Agent Manager, navigate chats, or accept file edits
        aggressiveCommands: [
            'antigravity.agent.acceptAgentStep',               // ⚠️ Opens Agent Manager when nothing pending
            'antigravity.command.accept',                       // ⚠️ Generic accept — can navigate between chats
            'antigravity.prioritized.agentAcceptAllInFile',    // Accept ALL changes in file
            'antigravity.prioritized.agentAcceptFocusedHunk',  // Accept focused hunk
            'antigravity.prioritized.supercompleteAccept',     // Accept supercomplete
            'antigravity.acceptCompletion',                     // Accept inline completion
        ],
    },
    {
        key: 'copilot',
        label: 'Copilot',
        contextKeywords: ['copilot'],
        safeCommands: [
            'github.copilot.terminal.acceptCommand',
            'github.copilot.chat.acceptTerminalCommand',
        ],
        aggressiveCommands: [
            'github.copilot.acceptSuggestion',  // Accept inline suggestion — can cause jumps
        ],
    },
];

// VS Code built-in chat/terminal commands (always included, these are safe)
const BUILTIN_COMMANDS = [
    'workbench.action.chat.acceptTerminalCommand',
    'workbench.action.chat.runInTerminal',
    'chat.action.acceptCommand',
    'chat.acceptTerminalCommand',
    'workbench.action.terminal.chat.acceptCommand',
    'workbench.action.terminal.acceptSuggestion',
];

let isEnabled = true;
let pollingTimer: NodeJS.Timeout | undefined;
let statusBarItem: vscode.StatusBarItem;
let outputChannel: vscode.OutputChannel;
let discoveredCommands: string[] = [];

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Auto Accept AG');
    outputChannel.appendLine('🚀 Auto Accept AG activated');

    // ─── Status Bar ───
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.command = 'autoAcceptAG.toggle';
    context.subscriptions.push(statusBarItem);

    // ─── Read config ───
    const config = vscode.workspace.getConfiguration('autoAcceptAG');
    isEnabled = config.get<boolean>('enabled', true);
    updateStatusBar();
    statusBarItem.show();

    // ─── Register commands ───
    context.subscriptions.push(
        vscode.commands.registerCommand('autoAcceptAG.toggle', toggleAutoAccept),
        vscode.commands.registerCommand('autoAcceptAG.discoverCommands', discoverAndLogCommands)
    );

    // ─── Initial command discovery ───
    discoverAcceptCommands().then(() => {
        outputChannel.appendLine(`✅ Found ${discoveredCommands.length} accept-related commands`);
        discoveredCommands.forEach(cmd => outputChannel.appendLine(`  → ${cmd}`));

        // Start polling if enabled
        if (isEnabled) {
            startPolling();
        }
    });

    // ─── Listen for config changes ───
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('autoAcceptAG')) {
                const newConfig = vscode.workspace.getConfiguration('autoAcceptAG');
                isEnabled = newConfig.get<boolean>('enabled', true);
                updateStatusBar();

                // Re-discover commands (provider toggles may have changed)
                discoverAcceptCommands().then(() => {
                    outputChannel.appendLine(`🔄 Re-discovered ${discoveredCommands.length} commands after config change`);

                    if (isEnabled) {
                        startPolling();
                    } else {
                        stopPolling();
                    }
                });
            }
        })
    );

    outputChannel.appendLine('✅ Extension ready');
}

// ─── Toggle on/off ───
function toggleAutoAccept() {
    isEnabled = !isEnabled;
    updateStatusBar();

    // Persist to settings
    const config = vscode.workspace.getConfiguration('autoAcceptAG');
    config.update('enabled', isEnabled, vscode.ConfigurationTarget.Global);

    if (isEnabled) {
        startPolling();
        vscode.window.showInformationMessage('Auto Accept AG: ✅ Enabled');
    } else {
        stopPolling();
        vscode.window.showInformationMessage('Auto Accept AG: ❌ Disabled');
    }

    outputChannel.appendLine(`🔄 Auto Accept ${isEnabled ? 'ENABLED' : 'DISABLED'}`);
}

// ─── Status Bar UI ───
function updateStatusBar() {
    const config = vscode.workspace.getConfiguration('autoAcceptAG');
    const enabledProviders = PROVIDERS
        .filter(p => config.get<boolean>(`providers.${p.key}`, true))
        .map(p => p.label);

    const aggressiveMode = config.get<boolean>('aggressiveMode', false);
    const modeLabel = aggressiveMode ? ' ⚡' : '';

    if (isEnabled) {
        const providerText = enabledProviders.length > 0
            ? enabledProviders.join(', ')
            : 'None';
        statusBarItem.text = `$(check) Auto Accept: ON [${providerText}]${modeLabel}`;
        statusBarItem.tooltip = `Auto-accept enabled for: ${providerText}\nMode: ${aggressiveMode ? 'Aggressive (file edits + completions)' : 'Safe (terminal + agent only)'}\nClick to disable`;
        statusBarItem.backgroundColor = undefined;
    } else {
        statusBarItem.text = '$(x) Auto Accept: OFF';
        statusBarItem.tooltip = 'Click to enable auto-accept for AI commands';
        statusBarItem.backgroundColor = new vscode.ThemeColor(
            'statusBarItem.warningBackground'
        );
    }
}

// ─── Get enabled provider commands ───
function getEnabledProviderCommands(): string[] {
    const config = vscode.workspace.getConfiguration('autoAcceptAG');
    const aggressiveMode = config.get<boolean>('aggressiveMode', false);
    const commands: string[] = [];

    for (const provider of PROVIDERS) {
        const providerEnabled = config.get<boolean>(`providers.${provider.key}`, true);
        if (providerEnabled) {
            // Always include safe commands
            commands.push(...provider.safeCommands);

            // Only include aggressive commands if aggressiveMode is ON
            if (aggressiveMode) {
                commands.push(...provider.aggressiveCommands);
            }
        }
    }

    // Always include built-in commands (these are safe)
    commands.push(...BUILTIN_COMMANDS);

    return commands;
}

// ─── Command Discovery ───
async function discoverAcceptCommands(): Promise<void> {
    const allCommands = await vscode.commands.getCommands(true);
    const config = vscode.workspace.getConfiguration('autoAcceptAG');
    const patterns = config.get<string[]>('commandPatterns', [
        'accept',
        'approve',
        'continue',
        'runCommand',
        'confirmAction',
    ]);

    const enabledKnownCommands = getEnabledProviderCommands();

    // Find commands matching our enabled known list
    const fromKnown = enabledKnownCommands.filter(cmd =>
        allCommands.includes(cmd)
    );

    // Find additional commands by pattern matching (only for enabled providers)
    const enabledContextKeywords = PROVIDERS
        .filter(p => config.get<boolean>(`providers.${p.key}`, true))
        .flatMap(p => p.contextKeywords);

    // Add built-in context keywords
    const allContextKeywords = [...enabledContextKeywords, 'chat', 'terminal'];

    // Must also contain "terminal" or "agent" to be safe — avoid matching completion/suggestion commands
    const safeActionKeywords = ['terminal', 'agent', 'chat'];

    const fromPatterns = allCommands.filter(cmd => {
        const lowerCmd = cmd.toLowerCase();

        // Must be in relevant context (provider or built-in)
        const isRelevantContext = allContextKeywords.some(kw =>
            lowerCmd.includes(kw)
        );

        // Must contain an accept-like action keyword
        const isAcceptAction = patterns.some(p =>
            lowerCmd.includes(p.toLowerCase())
        );

        // Must also be a safe action (related to terminal/agent/chat)
        const isSafeAction = safeActionKeywords.some(kw =>
            lowerCmd.includes(kw)
        );

        // Skip completion/suggestion commands unless aggressive mode
        const aggressiveMode = config.get<boolean>('aggressiveMode', false);
        const isCompletionCmd = lowerCmd.includes('completion') || lowerCmd.includes('suggestion') || lowerCmd.includes('supercomplete');

        if (!aggressiveMode && isCompletionCmd) {
            return false;
        }

        return isRelevantContext && isAcceptAction && isSafeAction;
    });

    // Filter out commands from disabled providers
    const disabledKeywords = PROVIDERS
        .filter(p => !config.get<boolean>(`providers.${p.key}`, true))
        .flatMap(p => p.contextKeywords);

    const filteredPatterns = fromPatterns.filter(cmd => {
        const lowerCmd = cmd.toLowerCase();
        return !disabledKeywords.some(kw => lowerCmd.includes(kw));
    });

    // Merge and deduplicate
    discoveredCommands = [...new Set([...fromKnown, ...filteredPatterns])];
}

// ─── Discover & Log (user command) ───
async function discoverAndLogCommands() {
    outputChannel.show();
    outputChannel.appendLine('\n═══════════════════════════════════════');
    outputChannel.appendLine('🔍 Discovering accept-related commands...');
    outputChannel.appendLine('═══════════════════════════════════════');

    const config = vscode.workspace.getConfiguration('autoAcceptAG');
    const aggressiveMode = config.get<boolean>('aggressiveMode', false);

    // Log provider & mode status
    outputChannel.appendLine('\n📊 Status:');
    outputChannel.appendLine(`  Mode: ${aggressiveMode ? '⚡ Aggressive' : '🛡️ Safe'}`);
    for (const provider of PROVIDERS) {
        const enabled = config.get<boolean>(`providers.${provider.key}`, true);
        outputChannel.appendLine(`  ${enabled ? '🟢' : '🔴'} ${provider.label}: ${enabled ? 'ON' : 'OFF'}`);
    }

    const allCommands = await vscode.commands.getCommands(true);

    // Build context keywords from all providers (show all for discovery)
    const allKeywords = [
        ...PROVIDERS.flatMap(p => p.contextKeywords),
        'chat', 'terminal', 'agent', 'ai'
    ];

    const relevantCommands = allCommands.filter(cmd => {
        const l = cmd.toLowerCase();
        return allKeywords.some(kw => l.includes(kw));
    });

    outputChannel.appendLine(`\n📋 All chat/terminal/AI commands (${relevantCommands.length}):`);
    relevantCommands.sort().forEach(cmd => {
        const isActive = discoveredCommands.includes(cmd);
        outputChannel.appendLine(`  ${isActive ? '🟢' : '⚪'} ${cmd}`);
    });

    // Re-discover
    await discoverAcceptCommands();
    outputChannel.appendLine(`\n✅ Commands that WILL auto-trigger (${discoveredCommands.length}):`);
    discoveredCommands.forEach(cmd => outputChannel.appendLine(`  → ${cmd}`));

    // Show aggressive commands that are NOT active
    if (!aggressiveMode) {
        const allAggressive = PROVIDERS.flatMap(p => p.aggressiveCommands);
        const availableAggressive = allAggressive.filter(cmd => allCommands.includes(cmd));
        if (availableAggressive.length > 0) {
            outputChannel.appendLine(`\n⚠️ Aggressive commands available but INACTIVE (set aggressiveMode=true to enable):`);
            availableAggressive.forEach(cmd => outputChannel.appendLine(`  ⚡ ${cmd}`));
        }
    }

    outputChannel.appendLine('═══════════════════════════════════════\n');

    if (discoveredCommands.length === 0) {
        vscode.window.showWarningMessage(
            'Auto Accept AG: No accept commands found. Check Output panel for details.'
        );
    } else {
        vscode.window.showInformationMessage(
            `Auto Accept AG: Found ${discoveredCommands.length} accept commands (${aggressiveMode ? 'aggressive' : 'safe'} mode). See Output panel.`
        );
    }
}

// ─── Polling: Try to auto-accept ───
function startPolling() {
    stopPolling(); // Clear any existing timer

    const config = vscode.workspace.getConfiguration('autoAcceptAG');
    const interval = config.get<number>('pollingInterval', 300);

    outputChannel.appendLine(`▶️ Starting polling (every ${interval}ms, ${discoveredCommands.length} commands)`);

    pollingTimer = setInterval(async () => {
        if (!isEnabled || discoveredCommands.length === 0) {
            return;
        }

        // Fire all discovered commands in parallel — unavailable ones silently fail
        await Promise.allSettled(
            discoveredCommands.map(cmd => vscode.commands.executeCommand(cmd))
        );
    }, interval);
}

function stopPolling() {
    if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = undefined;
        outputChannel.appendLine('⏹️ Polling stopped');
    }
}

export function deactivate() {
    stopPolling();
    outputChannel?.appendLine('👋 Auto Accept AG deactivated');
    outputChannel?.dispose();
}
