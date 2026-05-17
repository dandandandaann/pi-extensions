/**
 * /call command - delegate tasks to other agents
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Input } from "@mariozechner/pi-tui";
import type { AgentConfig, SpawnResult } from "../types";
import { getAgentByIdOrName } from "../agents";
import { runSync, formatSpawnResult } from "../spawn";

/**
 * Register the /call command
 */
export function registerCallCommand(
	pi: { registerCommand: (name: string, cmd: unknown) => void },
	agents: AgentConfig[]
): void {
	pi.registerCommand("call", {
		description: "Call another agent with a task",
		handler: async (args: string, ctx: ExtensionContext) => {
			const trimmedArgs = args.trim();

			// If no arguments provided, show interactive picker
			if (!trimmedArgs) {
				// Check if there are any agents configured
				if (agents.length === 0) {
					ctx.ui.notify("No agents configured. Use /agents to see available agents.", "warning");
					return;
				}

				// Build picker items as strings
				const items: string[] = agents.map((agent) => {
					const model = agent.model ? ` (${agent.model.model})` : "";
					const desc = agent.purpose ? ` - ${agent.purpose}` : "";
					return `[${agent.id}] ${agent.name}${model}${desc}`;
				});

				// Show interactive picker
				const selected = await ctx.ui.select("Select Agent to Call", items);

				if (!selected) {
					return;
				}

				// Parse selection - extract agent ID from "[agent-id] name..." format
				const idMatch = selected.match(/^\[([^\]]+)\]/);
				if (!idMatch) {
					ctx.ui.notify("Invalid selection format", "warning");
					return;
				}
				const agentId = idMatch[1];

				// Find the selected agent by ID
				const targetAgent = agents.find((a) => a.id === agentId);
				if (!targetAgent) {
					ctx.ui.notify(`Selected agent not found: ${agentId}`, "warning");
					return;
				}

				// Prompt for task using custom input component
				const task = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
					const input = new Input();
					input.focused = true;

					input.onSubmit = (text) => done(text);

					return {
						render: (w) => {
							const prompt = theme.fg("accent", `Task for ${targetAgent.name}:`);
							const placeholder = theme.fg("dim", "What should this agent do?");
							const inputLine = input.render(w)[0] || placeholder;
							return [prompt, inputLine];
						},
						invalidate: () => input.invalidate(),
						handleInput: (data) => {
							input.handleInput(data);
							tui.requestRender();
						},
					};
				});

				// User cancelled or provided empty task
				if (!task || !task.trim()) {
					ctx.ui.notify("Task cannot be empty", "warning");
					return;
				}

				// Run the agent
				const runId = `call-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
				const result: SpawnResult = await runSync(targetAgent.id, task.trim(), { runId });
				const formattedResult = formatSpawnResult(result);
				ctx.ui.notify(formattedResult, "info");
				return;
			}

			// Split on first space to get agent ID
			const spaceIndex = trimmedArgs.indexOf(" ");
			let agentId: string;
			let task: string;

			if (spaceIndex > 0) {
				agentId = trimmedArgs.substring(0, spaceIndex);
				task = trimmedArgs.substring(spaceIndex + 1).trim();
			} else {
				agentId = trimmedArgs;
				task = "";
			}

			if (!agentId) {
				ctx.ui.notify("Usage: /call <agent-id> <task>", "warning");
				return;
			}

			if (!task) {
				ctx.ui.notify("Task cannot be empty", "warning");
				return;
			}

			// Check if agent exists
			const targetAgent = getAgentByIdOrName(agentId);
			if (!targetAgent) {
				ctx.ui.notify(`Unknown agent: ${agentId}`, "warning");
				return;
			}

			// Run the agent
			const runId = `call-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
			const result: SpawnResult = await runSync(targetAgent.id, task, { runId });

			// Format and return the result
			const formattedResult = formatSpawnResult(result);
			ctx.ui.notify(formattedResult, "info");
		},
	});
}