/**
 * Pi Agent Selector Extension
 *
 * Wires all modules together and registers tools/commands/shortcuts/event handlers.
 * This is the main extension module that initializes the extension.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	BeforeAgentStartEvent,
} from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import { Type } from "typebox";

import type { AgentConfig } from "./types/index.js";
import { AgentStateManager, getAgentByIdOrName } from "./agents/index.js";
import { DEFAULT_SETTINGS, type AgentSettings } from "./config/index.js";
import { buildAgentListForTools } from "./prompts/index.js";
import { registerAgentCommand, registerAgentsCommand, registerCallCommand, registerNCommand } from "./commands/index.js";
import { runSync, formatSpawnResult } from "./spawn/index.js";
import type { SpawnResult } from "./types/index.js";

/**
 * Apply agent configuration to the extension context
 */
function applyAgentConfig(
	agent: AgentConfig,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	settings: AgentSettings
): void {
	if (settings.showInStatusBar) {
		ctx.ui.setStatus("agent-xpto", `Agent: ${agent.name}`);
	}
	ctx.ui.notify(`Switched to ${agent.name}`, "info");

	if (agent.model) {
		const model = ctx.modelRegistry.find(agent.model.provider, agent.model.model);
		if (model) {
			pi.setModel(model);
		}
	}
	if (agent.thinkingLevel) {
		pi.setThinkingLevel(agent.thinkingLevel);
	}
}

/**
 * Cycle to next agent
 */
function cycleToNextAgent(
	state: AgentStateManager,
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	settings: AgentSettings
): AgentConfig | null {
	const nextAgent = state.cycleAgent();
	if (nextAgent) {
		if (settings.showInStatusBar) {
			ctx.ui.setStatus("agent-xpto", `Agent: ${nextAgent.name}`);
		}
		ctx.ui.notify(`Agent: ${nextAgent.name}`, "info");

		if (nextAgent.model) {
			const model = ctx.modelRegistry.find(nextAgent.model.provider, nextAgent.model.model);
			if (model) {
				pi.setModel(model);
			}
		}
		if (nextAgent.thinkingLevel) {
			pi.setThinkingLevel(nextAgent.thinkingLevel);
		}
	}
	return nextAgent;
}

/**
 * Main extension function
 */
export function createAgentSelectorExtension(pi: ExtensionAPI): void {
	// Initialize state manager
	const state = new AgentStateManager();
	let agents = state.getAgents();
	let settings: AgentSettings = { ...DEFAULT_SETTINGS };

	// ============================================================================
	// Refresh agents function
	// ============================================================================

	function refreshAgents(): void {
		state.refresh();
		agents = state.getAgents();
		if (agents.length === 0) {
			console.warn("[agent-xpto] No agent files found");
		}
	}

	// ============================================================================
	// Event Handlers
	// ============================================================================

	// Initialize on session start
	pi.on("session_start", async (_event: unknown, ctx: ExtensionContext & { sessionManager?: { getEntries: () => any[] } }) => {
		refreshAgents();

		// Check for target agent from /n command
		let targetAgent: AgentConfig | null = null;
		if (ctx.sessionManager) {
			const entries = ctx.sessionManager.getEntries();
			const targetEntry = entries.find(
				(e: any) => e.type === "custom" && e.customType === "agent-xpto-target"
			);
			if (targetEntry && targetEntry.data?.targetAgentId) {
				targetAgent = getAgentByIdOrName(targetEntry.data.targetAgentId);
			}
		}

		// If no target from /n, use current agent (default behavior)
		const agent = targetAgent || state.getCurrentAgent();
		if (agent) {
			// If we found a target from /n marker, actually switch to it in the state manager
			if (targetAgent) {
				state.switchToAgent(agent.id);
			}
		}

		// Set model if configured
		if (agent.model) {
			const model = ctx.modelRegistry.find(agent.model.provider, agent.model.model);
			if (model && ctx.modelRegistry.hasConfiguredAuth(model)) {
				await pi.setModel(model);
			} else if (model) {
				ctx.ui.notify(`Agent "${agent.name}" model has no API key`, "warning");
			} else {
				ctx.ui.notify(`Agent "${agent.name}" model not found: ${agent.model.provider}/${agent.model.model}`, "warning");
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
		async (event: BeforeAgentStartEvent, _ctx: ExtensionContext) => {
			const agent = state.getCurrentAgent();
			if (!agent) return {};

			const modifications: {
				systemPrompt?: string;
				message?: { customType: string; content: string; display: boolean };
			} = {};

			// Inject agent-specific system prompt
			if (agent.systemPrompt) {
				// Dynamic import to avoid circular dependency
				const { buildAgentSystemPrompt } = await import("./prompts/index.js");
				const agentPrompt = buildAgentSystemPrompt(agent);
				modifications.systemPrompt = `${agentPrompt}\n\n${event.systemPrompt}`;
			}

			return modifications;
		},
	);

	// Tool call filtering
	pi.on("tool_call", async (event: ToolCallEvent, _ctx: ExtensionContext) => {
		const agent = state.getCurrentAgent();
		if (!agent) return undefined;

		// Check if tool is explicitly disabled
		if (agent.tools[event.toolName] === false) {
			return {
				block: true,
				reason: `${agent.name} agent cannot use \`${event.toolName}\` tool. This tool is disabled for this agent.`,
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
	// Custom Tools
	// ============================================================================

	pi.registerTool({
		name: "call",
		label: "Call Agent",
		description: `Delegate a task to another agent. Use this when you need specialized help or want to offload work.

${buildAgentListForTools(agents)}`,
		promptSnippet: "Delegate tasks to specialized agents",
		promptGuidelines: [
			"Use call when the user asks for help that would benefit from a specialized agent.",
			"Use call when a task can be parallelized and done in parallel.",
			"Use call when you want to delegate work while you continue with other tasks.",
			"Use call when the user explicitly asks you to use a specific agent.",
		],
		parameters: Type.Object({
			agentId: Type.String({
				description: "The ID of the agent to call (e.g., 'reviewer', 'architect', 'debugger')",
			}),
			task: Type.String({
				description: "The task to give the agent. Be specific about what you want the agent to do.",
			}),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const agentId = params.agentId;
			const task = params.task;

			// Find agent by ID or name
			const { getAgentByIdOrName } = await import("./agents/index.js");
			const targetAgent = getAgentByIdOrName(agentId);
			if (!targetAgent) {
				throw new Error(`Unknown agent: ${agentId}. Use /agents to see available agents.`);
			}

			// Run the agent
			const runId = `call-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
			const result: SpawnResult = await runSync(targetAgent.id, task, { runId, signal });

			// Format result
			const formattedResult = formatSpawnResult(result);

			return {
				content: [{ type: "text", text: formattedResult }],
				details: {
					agent: targetAgent.name,
					task,
					exitCode: result.exitCode,
					error: result.error,
				},
			};
		},
	});

	// ============================================================================
	// Commands
	// ============================================================================

	// Helper to get current agent or first agent
	const getCurrentAgent = (): AgentConfig | null => state.getCurrentAgent();

	// /agent command
	registerAgentCommand(
		pi,
		agents,
		getCurrentAgent,
		(id) => state.switchToAgent(id),
		(agent, ctx) => applyAgentConfig(agent, pi, ctx, settings),
		settings.showInStatusBar
	);

	// /agents command
	registerAgentsCommand(pi, agents, getCurrentAgent);

	// /call command
	registerCallCommand(pi, agents);

	// /n command - start new session with optional agent
	registerNCommand(
		pi,
		getAgentByIdOrName,
		(id) => state.switchToAgent(id),
		(agent, ctx) => applyAgentConfig(agent, pi, ctx, settings)
	);

	// ============================================================================
	// Keyboard Shortcuts
	// ============================================================================

	// Cycle through agents
	pi.registerShortcut(Key.alt("a"), {
		description: "Alt+A: Cycle to next agent",
		handler: async (ctx: ExtensionContext) => {
			cycleToNextAgent(state, pi, ctx, settings);
		},
	});

	// Open agent selector
	pi.registerShortcut(Key.alt("s"), {
		description: "Alt+S: Open agent selector",
		handler: async (ctx: ExtensionContext) => {
			if (!agents.length) {
				ctx.ui.notify("No agents configured", "warning");
				return;
			}

			const currentAgent = getCurrentAgent();
			const items = agents.map((agent) => {
				const marker = agent.id === currentAgent?.id ? "▸ " : "  ";
				return `${marker}${agent.name}`;
			});

			const selected = await ctx.ui.select("Select Agent", items);

			if (selected) {
				const name = selected.replace(/^[▸ ]+/, "").trim();
				const agent = agents.find((a) => a.name === name);
				if (agent) {
					state.switchToAgent(agent.id);
					applyAgentConfig(agent, pi, ctx, settings);
				}
			}
		},
	});
}