import * as vscode from 'vscode';

// ─── Provider definitions with their known commands ───
interface ProviderDef {
    key: string;
    label: string;
    contextKeywords: string[];
    knownCommands: string[];
}

const PROVIDERS: ProviderDef[] = [
    {
        key: 'antigravity',
        label: 'Antigravity',
        contextKeywords: ['antigravity'],
        knownCommands: [
            // Verified from Munkhin/auto-accept-agent repo
            'antigravity.agent.acceptAgentStep',
            'antigravity.command.accept',
            'antigravity.prioritized.agentAcceptAllInFile',
            'antigravity.prioritized.agentAcceptFocusedHunk',
            'antigravity.prioritized.supercompleteAccept',
            'antigravity.terminalCommand.accept',
            'antigravity.acceptCompletion',
            'antigravity.prioritized.terminalSuggestion.accept',
        ],
    },
    {
        key: 'copilot',
        label: 'Copilot',
        contextKeywords: ['copilot'],
        knownCommands: [
            'github.copilot.terminal.acceptCommand',
            'github.copilot.chat.acceptTerminalCommand',
            'github.copilot.acceptSuggestion',
        ],
    },
];

// VS Code built-in chat/terminal commands (always included when master toggle is on)
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

    if (isEnabled) {
        const providerText = enabledProviders.length > 0
            ? enabledProviders.join(', ')
            : 'None';
        statusBarItem.text = `$(check) Auto Accept: ON [${providerText}]`;
        statusBarItem.tooltip = `Auto-accept enabled for: ${providerText}\nClick to disable`;
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
    const commands: string[] = [];

    for (const provider of PROVIDERS) {
        const providerEnabled = config.get<boolean>(`providers.${provider.key}`, true);
        if (providerEnabled) {
            commands.push(...provider.knownCommands);
        }
    }

    // Always include built-in commands
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
    const allContextKeywords = [...enabledContextKeywords, 'chat', 'terminal', 'agent'];

    const fromPatterns = allCommands.filter(cmd => {
        const lowerCmd = cmd.toLowerCase();
        const isRelevantContext = allContextKeywords.some(kw =>
            lowerCmd.includes(kw)
        );

        const isAcceptAction = patterns.some(p =>
            lowerCmd.includes(p.toLowerCase())
        );

        return isRelevantContext && isAcceptAction;
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

    // Log provider status
    outputChannel.appendLine('\n📊 Provider Status:');
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
        const isAccept = discoveredCommands.includes(cmd);
        outputChannel.appendLine(`  ${isAccept ? '🟢' : '⚪'} ${cmd}`);
    });

    // Re-discover
    await discoverAcceptCommands();
    outputChannel.appendLine(`\n✅ Accept commands to auto-trigger (${discoveredCommands.length}):`);
    discoveredCommands.forEach(cmd => outputChannel.appendLine(`  → ${cmd}`));

    outputChannel.appendLine('═══════════════════════════════════════\n');

    if (discoveredCommands.length === 0) {
        vscode.window.showWarningMessage(
            'Auto Accept AG: No accept commands found. Check Output panel for details.'
        );
    } else {
        vscode.window.showInformationMessage(
            `Auto Accept AG: Found ${discoveredCommands.length} accept commands. See Output panel.`
        );
    }
}

// ─── Polling: Try to auto-accept ───
function startPolling() {
    stopPolling(); // Clear any existing timer

    const config = vscode.workspace.getConfiguration('autoAcceptAG');
    const interval = config.get<number>('pollingInterval', 300);

    outputChannel.appendLine(`▶️ Starting polling (every ${interval}ms)`);

    pollingTimer = setInterval(async () => {
        if (!isEnabled || discoveredCommands.length === 0) {
            return;
        }

        // Use Promise.allSettled for better performance (parallel execution)
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
