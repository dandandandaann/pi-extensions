/**
 * Settings interface and defaults for agent-xpto extension
 */

export interface AgentSettings {
	hotkey: string;
	showInStatusBar: boolean;
	rememberLastAgent: boolean;
	cycleWraps: boolean;
}

/**
 * Default agent settings
 */
export const DEFAULT_SETTINGS: AgentSettings = {
	hotkey: "ctrl+shift+a",
	showInStatusBar: true,
	rememberLastAgent: true,
	cycleWraps: true,
};

export interface AgentsConfig {
	version: number;
	agents: Array<{
		id: string;
		name: string;
		purpose?: string;
		systemPrompt?: string;
		tools: Record<string, boolean>;
		model?: { provider: string; model: string };
		thinkingLevel?: string;
	}>;
	settings: AgentSettings;
	defaultAgent: string;
}