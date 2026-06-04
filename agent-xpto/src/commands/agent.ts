/**
 * /agent command logic
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "../types";
import { getAgentByIdOrName, setAgentTemperature } from "../agents";
import { getEnabledToolNames } from "../tools";

/**
 * Build items for the agent picker UI
 */
export function buildAgentPickerItems(currentAgent: AgentConfig, agents: AgentConfig[]): string[] {
	const items: string[] = [];
	for (let i = 0; i < agents.length; i++) {
		const agent = agents[i];
		const marker = agent.id === currentAgent.id ? "▸ " : "  ";
		const orderStr = agent.order !== undefined ? ` [order: ${agent.order}]` : "";
		const model = agent.model ? ` (${agent.model.model})` : "";
		const lines = [`${marker}[${i + 1}] ${agent.name}${model}`];
		if (agent.purpose) {
			lines.push(`      ${agent.purpose}`);
		}
		items.push(lines.join("\n"));
	}
	items.push("---");
	items.push("[C] Cycle to next agent");
	return items;
}

/**
 * Apply agent configuration to the extension
 */
export function applyAgentConfig(
	agent: AgentConfig,
	pi: { setModel: (model: unknown) => void; setThinkingLevel: (level: string) => void },
	ctx: ExtensionContext,
	showStatusBar: boolean
): void {
	if (showStatusBar) {
		ctx.ui.setStatus("agent-xpto", `Agent: ${agent.name}`);
	}
	ctx.ui.notify(`Switched to ${agent.name}`, "info");

	setAgentTemperature(agent.temperature);

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
 * Handle agent selection from picker
 */
export function handleAgentSelection(
	selected: string,
	agents: AgentConfig[],
	switchToAgent: (id: string) => AgentConfig | null,
	applyConfig: (agent: AgentConfig, ctx: ExtensionContext) => void,
	ctx: ExtensionContext
): void {
	if (selected === "[C] Cycle to next agent") {
		const currentIndex = agents.findIndex((a) => switchToAgent(a.id) !== null);
		const nextIndex = (currentIndex + 1) % agents.length;
		const nextAgent = agents[nextIndex];
		if (nextAgent) {
			switchToAgent(nextAgent.id);
			applyConfig(nextAgent, ctx);
		}
		return;
	}

	const firstLine = selected.split("\n")[0];
	const match = firstLine.match(/\[(\d+)\]\s+(.+)/);
	if (match) {
		const index = parseInt(match[1], 10) - 1;
		if (index >= 0 && index < agents.length) {
			const newAgent = switchToAgent(agents[index].id);
			if (newAgent) {
				applyConfig(newAgent, ctx);
			}
		}
	}
}

/**
 * Register the /agent command
 */
export function registerAgentCommand(
	pi: { registerCommand: (name: string, cmd: unknown) => void },
	agents: AgentConfig[],
	getCurrentAgent: () => AgentConfig | null,
	switchToAgent: (id: string) => AgentConfig | null,
	applyConfig: (agent: AgentConfig, ctx: ExtensionContext) => void,
	showStatusBar: boolean
): void {
	pi.registerCommand("agent", {
		description: "Show or switch between agents. Usage: /agent [agent-id]",
		handler: async (args: string, ctx: ExtensionContext) => {
			if (!agents.length) {
				ctx.ui.notify("No agents configured", "warning");
				return;
			}

			const trimmedArgs = args.trim();

			// If argument provided, try to match and switch directly
			if (trimmedArgs) {
				const targetAgent = getAgentByIdOrName(trimmedArgs);
				if (targetAgent) {
					const newAgent = switchToAgent(targetAgent.id);
					if (newAgent) {
						applyConfig(newAgent, ctx);
					}
					return;
				} else {
					// No match - show list with warning
					ctx.ui.notify(`Unknown agent: "${trimmedArgs}"`, "warning");
					const items = buildAgentPickerItems(getCurrentAgent() || agents[0], agents);
					const selected = await ctx.ui.select("Select Agent", items);
					if (!selected) return;
					handleAgentSelection(selected, agents, switchToAgent, applyConfig, ctx);
					return;
				}
			}

			// No argument - show interactive picker
			const current = getCurrentAgent() || agents[0];
			const items = buildAgentPickerItems(current, agents);
			const selected = await ctx.ui.select("Select Agent", items);
			if (!selected) return;
			handleAgentSelection(selected, agents, switchToAgent, applyConfig, ctx);
		},
	});
}

/**
 * Register the /n command - start new session with optional agent
 */
export function registerNCommand(
	pi: { registerCommand: (name: string, cmd: unknown) => void },
	getAgentByIdOrName: (id: string) => AgentConfig | undefined,
	switchToAgent: (id: string) => AgentConfig | null,
	applyConfig: (agent: AgentConfig, ctx: ExtensionContext) => void
): void {
	pi.registerCommand("n", {
		description: "Start a new session. Optional: /n [agent-id] to start with a specific agent.",
		handler: async (args: string, ctx: ExtensionContext & { newSession?: (options?: { setup?: (manager: any) => void }) => Promise<{ cancelled: boolean }> }) => {
			const trimmedArgs = args.trim();

			// Capture the target agent ID before newSession (if agent exists)
			let targetAgentId: string | null = null;
			if (trimmedArgs) {
				const agent = getAgentByIdOrName(trimmedArgs);
				if (agent) {
					switchToAgent(agent.id);
					applyConfig(agent, ctx);
					targetAgentId = agent.id;
				} else {
					ctx.ui.notify(`Unknown agent: "${trimmedArgs}" - starting session anyway`, "warning");
				}
			}

			// Start new session, injecting marker if we have a target agent
			if (ctx.newSession) {
				await ctx.newSession({
					setup: (newSessionManager: any) => {
						if (targetAgentId) {
							// Inject marker so session_start knows which agent to set
							newSessionManager.appendCustomEntry("agent-xpto-target", { targetAgentId: targetAgentId });
						}
					},
				});
			} else {
				ctx.ui.notify("Cannot start new session from this context", "error");
			}
		},
	});
}