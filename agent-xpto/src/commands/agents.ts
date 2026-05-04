/**
 * /agents command - list all agents
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "../types";
import { getEnabledToolNames } from "../tools";

/**
 * Register the /agents command
 */
export function registerAgentsCommand(
	pi: { registerCommand: (name: string, cmd: unknown) => void },
	agents: AgentConfig[],
	getCurrentAgent: () => AgentConfig | null
): void {
	pi.registerCommand("agents", {
		description: "List all configured agents",
		handler: async (_args: string, ctx: ExtensionContext) => {
			if (!agents.length) {
				ctx.ui.notify("No agents configured", "info");
				return;
			}

			const currentAgent = getCurrentAgent();
			const lines: string[] = [`Current: ${currentAgent?.name ?? "none"}`, ""];

			for (const agent of agents) {
				const marker = agent.id === currentAgent?.id ? "▸ " : "  ";
				const model = agent.model ? ` [${agent.model.provider}/${agent.model.model}]` : "";
				const thinking = agent.thinkingLevel ? ` thinking: ${agent.thinkingLevel}` : "";
				lines.push(`${marker}${agent.name}${model}${thinking}`);

				if (agent.purpose) {
					lines.push(`   ${agent.purpose}`);
				}

				const enabledTools = getEnabledToolNames(agent);
				lines.push(`   Tools: ${enabledTools.join(", ") || "none"}`);
				lines.push("");
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}