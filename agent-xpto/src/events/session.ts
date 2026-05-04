/**
 * Session start event handler logic
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "../types";
import { DEFAULT_SETTINGS, type AgentSettings } from "../config";

/**
 * Initialize agents and apply configuration on session start
 */
export function handleSessionStart(
	agents: AgentConfig[],
	getCurrentAgent: () => AgentConfig | null,
	pi: {
		setModel: (model: unknown) => Promise<void>;
		setThinkingLevel: (level: string) => void;
	},
	ctx: ExtensionContext,
	settings?: AgentSettings
): void {
	const agent = getCurrentAgent();
	const resolvedSettings = settings ?? DEFAULT_SETTINGS;

	if (!agent) return;

	if (agent.model) {
		const model = ctx.modelRegistry.find(agent.model.provider, agent.model.model);
		if (model && ctx.modelRegistry.hasConfiguredAuth(model)) {
			pi.setModel(model);
		} else if (model) {
			ctx.ui.notify(`Agent "${agent.name}" model has no API key`, "warning");
		} else {
			ctx.ui.notify(`Agent "${agent.name}" model not found: ${agent.model.provider}/${agent.model.model}`, "warning");
		}
	}

	if (agent.thinkingLevel) {
		pi.setThinkingLevel(agent.thinkingLevel);
	}

	if (resolvedSettings.showInStatusBar) {
		ctx.ui.setStatus("agent-xpto", `Agent: ${agent.name}`);
	}
}