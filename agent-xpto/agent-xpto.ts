/**
 * Pi Agent Selector Extension
 *
 * A multi-agent system for pi that allows users to create and switch between
 * different specialized agents, each with their own instructions, tool
 * permissions, and model preferences.
 *
 * Features:
 * - Direct prompt routing to selected agent
 * - Hotkey agent selection (Ctrl+Shift+A cycles through agents)
 * - Per-agent tool limitations
 * - Per-agent model preferences
 * - Per-agent thinking level settings
 *
 * Usage:
 * - /agent - Show/select agents
 * - Ctrl+Shift+A - Cycle to next agent
 * - Ctrl+Shift+S - Open agent selector
 * - Ctrl+Shift+D - Show current agent
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	BeforeAgentStartEvent,
	BeforeProviderRequestEvent,
	AgentStartEvent,
} from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ============================================================================
// Types
// ============================================================================

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ModelConfig {
	provider: string;
	model: string;
}

export interface AgentTools {
	read?: boolean;
	write?: boolean;
	edit?: boolean;
	bash?: boolean;
	grep?: boolean;
	find?: boolean;
	[toolName: string]: boolean | undefined;
}

export interface AgentConfig {
	id: string;
	name: string;
	description?: string;
	systemPrompt?: string;
	tools: AgentTools;
	model?: ModelConfig;
	thinkingLevel?: ThinkingLevel;
}

export interface AgentSettings {
	hotkey: string;
	showInStatusBar: boolean;
	rememberLastAgent: boolean;
	cycleWraps: boolean;
}

export interface AgentsConfig {
	version: number;
	agents: AgentConfig[];
	settings: AgentSettings;
	defaultAgent: string;
}

// ============================================================================
// Constants
// ============================================================================

// Agent config file path in user's home directory
const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const CONFIG_FILE = "agents.json";

const DEFAULT_SYSTEM_PROMPT_HEADER = `# Agent Configuration: {agentName}

{agentDescription}

## Your Capabilities
{capabilities}

## Restrictions
{restrictions}

---

`;

const DEFAULT_CAPABILITIES = "You have access to all enabled tools as listed in your instructions.";

const DEFAULT_RESTRICTIONS = "Follow the agent configuration above. Only use tools that are explicitly enabled.";

// ============================================================================
// Helper Functions
// ============================================================================

function getConfigPath(): string {
	return path.join(AGENT_DIR, CONFIG_FILE);
}

function loadConfig(): AgentsConfig | null {
	try {
		const configPath = getConfigPath();
		if (!fs.existsSync(configPath)) {
			return null;
		}
		const content = fs.readFileSync(configPath, "utf-8");
		return JSON.parse(content) as AgentsConfig;
	} catch (error) {
		console.error("[agent-xpto] Failed to load config:", error);
		return null;
	}
}

function saveConfig(config: AgentsConfig): void {
	try {
		if (!fs.existsSync(AGENT_DIR)) {
			fs.mkdirSync(AGENT_DIR, { recursive: true });
		}
		const configPath = getConfigPath();
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
	} catch (error) {
		console.error("[agent-xpto] Failed to save config:", error);
	}
}

function createDefaultConfig(): AgentsConfig {
	return {
		version: 1,
		agents: [
			{
				id: "default",
				name: "Default",
				description: "General purpose coding assistant",
				systemPrompt: "You are a versatile coding assistant. Help users write, review, and debug code.",
				tools: {
					read: true,
					write: true,
					edit: true,
					bash: true,
					grep: true,
					find: true,
				},
				model: {
					provider: "localhost",
					model: "unsloth/gemma-4-e4b-it",
				},
				thinkingLevel: "medium",
			},
			{
				id: "reviewer",
				name: "Reviewer",
				description: "Code review specialist - no file modifications",
				systemPrompt:
					"You are a code reviewer. Analyze code and provide feedback. Do NOT make any changes. Focus on code quality, security, and best practices.",
				tools: {
					read: true,
					write: false,
					edit: false,
					bash: false,
					grep: true,
					find: true,
				},
				model: {
					provider: "anthropic",
					model: "claude-sonnet-4-5",
				},
				thinkingLevel: "high",
			},
			{
				id: "architect",
				name: "Architect",
				description: "System design and architecture specialist",
				systemPrompt:
					"You are a system design expert. Focus on architecture, scalability, and best practices. Create diagrams and specifications when helpful.",
				tools: {
					read: true,
					write: true,
					edit: false,
					bash: false,
					grep: true,
					find: true,
				},
				model: {
					provider: "anthropic",
					model: "claude-opus-4-5",
				},
				thinkingLevel: "high",
			},
			{
				id: "debugger",
				name: "Debugger",
				description: "Debugging and troubleshooting specialist",
				systemPrompt:
					"You are a debugging expert. Analyze error messages, trace issues, and provide solutions. Work systematically through problems.",
				tools: {
					read: true,
					write: true,
					edit: true,
					bash: true,
					grep: true,
					find: true,
				},
				model: {
					provider: "anthropic",
					model: "claude-sonnet-4-5",
				},
				thinkingLevel: "medium",
			},
		],
		settings: {
			hotkey: "ctrl+shift+a",
			showInStatusBar: true,
			rememberLastAgent: true,
			cycleWraps: true,
		},
		defaultAgent: "default",
	};
}

function buildCapabilityList(agent: AgentConfig): string {
	const enabledTools = Object.entries(agent.tools)
		.filter(([, enabled]) => enabled === true)
		.map(([tool]) => tool);

	if (enabledTools.length === 0) {
		return "No tools enabled.";
	}

	return `Enabled tools: ${enabledTools.join(", ")}.`;
}

function buildRestrictionList(agent: AgentConfig): string {
	const disabledTools = Object.entries(agent.tools)
		.filter(([, enabled]) => enabled === false)
		.map(([tool]) => tool);

	if (disabledTools.length === 0) {
		return "No restrictions.";
	}

	return `Disabled tools: ${disabledTools.join(", ")}. You CANNOT use these tools.`;
}

function buildAgentSystemPrompt(agent: AgentConfig): string {
	const header = DEFAULT_SYSTEM_PROMPT_HEADER
		.replace("{agentName}", agent.name)
		.replace("{agentDescription}", agent.description || agent.systemPrompt || "Specialized agent")
		.replace("{capabilities}", buildCapabilityList(agent))
		.replace("{restrictions}", buildRestrictionList(agent));

	return header.trim();
}

function getEnabledToolNames(agent: AgentConfig): string[] {
	return Object.entries(agent.tools)
		.filter(([, enabled]) => enabled === true)
		.map(([tool]) => tool);
}

// Helper to find model by provider+model or by model name with provider verification
function findModelWithProvider(models: any[], provider: string, model: string): any {
	// First try exact provider+model match
	let found = models?.find((m: any) => m.id === model && m.provider === provider);
	
	// If not found, try finding by model name suffix and verify provider
	if (!found) {
		found = models?.find((m: any) => m.id.endsWith(`/${model}`));
		if (found && found.provider !== provider) {
			console.log(`[agent-xpto] findModelWithProvider: Found ${found.id} but provider ${found.provider} != ${provider}, ignoring`);
			found = null;
		}
	}
	
	return found;
}

// ============================================================================
// Extension Implementation
// ============================================================================

export default function agentSelectorExtension(pi: ExtensionAPI) {
	// Extension-local state
	let agents: AgentConfig[] = [];
	let currentAgentIndex = 0;
	let settings: AgentSettings = {
		hotkey: "ctrl+shift+a",
		showInStatusBar: true,
		rememberLastAgent: true,
		cycleWraps: true,
	};
	let lastAgentId: string | null = null;

	// ============================================================================
	// Agent Management Functions
	// ============================================================================

	function getCurrentAgent(): AgentConfig {
		return agents[currentAgentIndex] || agents[0];
	}

	function switchToAgent(agentId: string): AgentConfig | null {
		const index = agents.findIndex((a) => a.id === agentId);
		if (index >= 0) {
			currentAgentIndex = index;
			lastAgentId = agentId;
			return getCurrentAgent();
		}
		return null;
	}

	function cycleAgent(): AgentConfig {
		currentAgentIndex = (currentAgentIndex + 1) % agents.length;
		lastAgentId = getCurrentAgent().id;
		return getCurrentAgent();
	}

	// ============================================================================
	// Initialization
	// ============================================================================

	function initializeAgents(): void {
		let config = loadConfig();

		if (!config) {
			config = createDefaultConfig();
			saveConfig(config);
		}

		agents = config.agents;
		settings = { ...settings, ...config.settings };

		// Set initial agent
		const defaultIndex = agents.findIndex((a) => a.id === config.defaultAgent);
		currentAgentIndex = defaultIndex >= 0 ? defaultIndex : 0;
		lastAgentId = getCurrentAgent().id;
	}

	// ============================================================================
	// Event Handlers
	// ============================================================================

	// Initialize on session start
	pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
		initializeAgents();

		const agent = getCurrentAgent();

		if (agent.model) {
			const models = (ctx.modelRegistry as any).models;
			const model = findModelWithProvider(models, agent.model.provider, agent.model.model);
			
			if (model && ctx.modelRegistry.hasConfiguredAuth(model)) {
				await pi.setModel(model);
			} else if (model) {
				ctx.ui.notify(`Agent "${agent.name}" model has no API key`, "warning");
			}
		}
		
		if (agent.thinkingLevel) {
			pi.setThinkingLevel(agent.thinkingLevel);
		}

		if (settings.showInStatusBar) {
			ctx.ui.setStatus("agent-xpto", `Agent: ${agent.name}`);
		}
	});

	// Handle agent switching before agent starts
	pi.on(
		"before_agent_start",
		async (event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
			const agent = getCurrentAgent();
			const currentModel = ctx.model;

			const modifications: {
				systemPrompt?: string;
				message?: { customType: string; content: string; display: boolean };
			} = {};

			// Inject agent-specific system prompt
			if (agent.systemPrompt) {
				const agentPrompt = buildAgentSystemPrompt(agent);
				modifications.systemPrompt = `${agentPrompt}\n\n${event.systemPrompt}`;
			}

			// Enforce agent model
			if (agent.model) {
				const models = (ctx.modelRegistry as any).models;
				const expectedModel = findModelWithProvider(models, agent.model.provider, agent.model.model);

				if (expectedModel && ctx.modelRegistry.hasConfiguredAuth(expectedModel)) {
					if (currentModel?.id !== expectedModel.id) {
						await pi.setModel(expectedModel);
					}
				} else if (expectedModel) {
					ctx.ui.notify(`Agent "${agent.name}" model has no API key`, "warning");
				}
			}

			return modifications;
		},
	);

	// Enforce model before provider request
	pi.on("before_provider_request", async (_event: BeforeProviderRequestEvent, ctx: ExtensionContext) => {
		const agent = getCurrentAgent();
		const currentModel = ctx.model;

		if (agent.model) {
			const models = (ctx.modelRegistry as any).models;
			const expectedModel = findModelWithProvider(models, agent.model.provider, agent.model.model);

			if (expectedModel && ctx.modelRegistry.hasConfiguredAuth(expectedModel)) {
				if (currentModel?.id !== expectedModel.id) {
					await pi.setModel(expectedModel);
				}
			}
		}

		return undefined;
	});

	// Enforce model on every turn
	pi.on("turn_start", async (_event, ctx: ExtensionContext) => {
		const agent = getCurrentAgent();

		if (agent.model) {
			const models = (ctx.modelRegistry as any).models;
			const expectedModel = findModelWithProvider(models, agent.model.provider, agent.model.model);

			if (expectedModel && ctx.modelRegistry.hasConfiguredAuth(expectedModel)) {
				if (ctx.model?.id !== expectedModel.id) {
					await pi.setModel(expectedModel);
				}
			}
		}

		if (agent.thinkingLevel) {
			pi.setThinkingLevel(agent.thinkingLevel);
		}
	});

	// Tool call filtering
	pi.on("tool_call", async (event: ToolCallEvent, _ctx: ExtensionContext) => {
		const agent = getCurrentAgent();
		const toolName = event.toolName;

		// Check if tool is explicitly disabled
		if (agent.tools[toolName] === false) {
			return {
				block: true,
				reason: `${agent.name} agent cannot use \`${toolName}\` tool. This tool is disabled for this agent.`,
			};
		}

		return undefined;
	});

	// Cleanup on shutdown
	pi.on("session_shutdown", async (_event: unknown, ctx: ExtensionContext) => {
		if (settings.showInStatusBar) {
			ctx.ui.setStatus("agent-xpto", undefined);
		}
	});

	// ============================================================================
	// Commands
	// ============================================================================

	// Main agent command - show/select agents
	pi.registerCommand("agent", {
		description: "Show or switch between agents",
		handler: async (_args: string, ctx: ExtensionContext) => {
			if (!agents.length) {
				ctx.ui.notify("No agents configured", "warning");
				return;
			}

			const currentAgent = getCurrentAgent();
			const items: string[] = [];

			for (let i = 0; i < agents.length; i++) {
				const agent = agents[i];
				const marker = agent.id === currentAgent.id ? "▸ " : "  ";
				const model = agent.model ? ` (${agent.model.model})` : "";
				items.push(`${marker}[${i + 1}] ${agent.name}${model}`);
				if (agent.description) {
					items.push(`      ${agent.description}`);
				}
			}

			items.push("---");
			items.push("[C] Cycle to next agent");

			const selected = await ctx.ui.select("Select Agent", items);

			if (!selected) return;

			// Handle cycle option
			if (selected === "[C] Cycle to next agent") {
				const nextAgent = cycleAgent();
				if (settings.showInStatusBar) {
					ctx.ui.setStatus("agent-xpto", `Agent: ${nextAgent.name}`);
				}
				ctx.ui.notify(`Switched to ${nextAgent.name}`, "info");

				// Trigger model/thinking level change
				if (nextAgent.model) {
					const models = (ctx.modelRegistry as any).models;
					const model = findModelWithProvider(models, nextAgent.model.provider, nextAgent.model.model);
					if (model) {
						await pi.setModel(model);
					}
				}
				if (nextAgent.thinkingLevel) {
					pi.setThinkingLevel(nextAgent.thinkingLevel);
				}
				return;
			}

			// Parse selection
			const match = selected.match(/\[(\d+)\]\s+(.+)/);
			if (match) {
				const index = parseInt(match[1], 10) - 1;
				if (index >= 0 && index < agents.length) {
					const newAgent = switchToAgent(agents[index].id);
					if (newAgent) {
						if (settings.showInStatusBar) {
							ctx.ui.setStatus("agent-xpto", `Agent: ${newAgent.name}`);
						}
						ctx.ui.notify(`Switched to ${newAgent.name}`, "info");

						// Apply model and thinking level
						if (newAgent.model) {
							const models = (ctx.modelRegistry as any).models;
							const model = findModelWithProvider(models, newAgent.model.provider, newAgent.model.model);
							if (model) {
								await pi.setModel(model);
							}
						}
						if (newAgent.thinkingLevel) {
							pi.setThinkingLevel(newAgent.thinkingLevel);
						}
					}
				}
			}
		},
	});

	// List all agents with details
	pi.registerCommand("agents", {
		description: "List all configured agents",
		handler: async (_args: string, ctx: ExtensionContext) => {
			if (!agents.length) {
				ctx.ui.notify("No agents configured", "info");
				return;
			}

			const currentAgent = getCurrentAgent();
			const lines: string[] = [`Current: ${currentAgent.name}`, ""];

			for (const agent of agents) {
				const marker = agent.id === currentAgent.id ? "▸ " : "  ";
				const model = agent.model ? ` [${agent.model.provider}/${agent.model.model}]` : "";
				const thinking = agent.thinkingLevel ? ` thinking: ${agent.thinkingLevel}` : "";
				lines.push(`${marker}${agent.name}${model}${thinking}`);

				if (agent.description) {
					lines.push(`   ${agent.description}`);
				}

				const enabledTools = getEnabledToolNames(agent);
				lines.push(`   Tools: ${enabledTools.join(", ") || "none"}`);
				lines.push("");
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	// ============================================================================
	// Keyboard Shortcuts
	// ============================================================================

	// Cycle through agents
	pi.registerShortcut("ctrl+shift+a", {
		description: "Cycle to next agent",
		handler: async (ctx: ExtensionContext) => {
			const nextAgent = cycleAgent();

			if (settings.showInStatusBar) {
				ctx.ui.setStatus("agent-xpto", `Agent: ${nextAgent.name}`);
			}
			ctx.ui.notify(`Agent: ${nextAgent.name}`, "info");

			// Apply model and thinking level
			if (nextAgent.model) {
				const models = (ctx.modelRegistry as any).models;
				const model = findModelWithProvider(models, nextAgent.model.provider, nextAgent.model.model);
				if (model) {
					await pi.setModel(model);
				}
			}
			if (nextAgent.thinkingLevel) {
				pi.setThinkingLevel(nextAgent.thinkingLevel);
			}
		},
	});

	// Open agent selector
	pi.registerShortcut("ctrl+shift+s", {
		description: "Open agent selector",
		handler: async (ctx: ExtensionContext) => {
			if (!agents.length) {
				ctx.ui.notify("No agents configured", "warning");
				return;
			}

			const currentAgent = getCurrentAgent();
			const items = agents.map((agent) => {
				const marker = agent.id === currentAgent.id ? "▸ " : "  ";
				return `${marker}${agent.name}`;
			});

			const selected = await ctx.ui.select("Select Agent", items);

			if (selected) {
				const name = selected.replace(/^[▸ ]+/, "").trim();
				const agent = agents.find((a) => a.name === name);
				if (agent) {
					switchToAgent(agent.id);
					if (settings.showInStatusBar) {
						ctx.ui.setStatus("agent-xpto", `Agent: ${agent.name}`);
					}
					ctx.ui.notify(`Switched to ${agent.name}`, "info");

					// Apply model and thinking level
					if (agent.model) {
						const models = (ctx.modelRegistry as any).models;
						const model = findModelWithProvider(models, agent.model.provider, agent.model.model);
						if (model) {
							await pi.setModel(model);
						}
					}
					if (agent.thinkingLevel) {
						pi.setThinkingLevel(agent.thinkingLevel);
					}
				}
			}
		},
	});

	// Show current agent
	pi.registerShortcut("ctrl+shift+d", {
		description: "Show current agent",
		handler: async (ctx: ExtensionContext) => {
			const agent = getCurrentAgent();
			const model = agent.model ? ` [${agent.model.model}]` : "";
			const thinking = agent.thinkingLevel ? ` | Thinking: ${agent.thinkingLevel}` : "";
			ctx.ui.notify(`Current: ${agent.name}${model}${thinking}`, "info");
		},
	});
}