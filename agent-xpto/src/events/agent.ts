/**
 * Before agent start event handler logic
 */

import type { BeforeAgentStartEvent } from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "../types";
import { buildAgentSystemPrompt } from "../prompts";

/**
 * Build system prompt modifications for the agent
 */
export function buildPromptModifications(
	agent: AgentConfig,
	eventSystemPrompt: string
): {
	systemPrompt?: string;
	message?: { customType: string; content: string; display: boolean };
} {
	const modifications: {
		systemPrompt?: string;
		message?: { customType: string; content: string; display: boolean };
	} = {};

	// Inject agent-specific system prompt
	if (agent.systemPrompt) {
		const agentPrompt = buildAgentSystemPrompt(agent);
		modifications.systemPrompt = `${agentPrompt}\n\n${eventSystemPrompt}`;
	}

	return modifications;
}

/**
 * Handle before_agent_start event
 */
export function handleBeforeAgentStart(
	agent: AgentConfig,
	event: BeforeAgentStartEvent
): {
	systemPrompt?: string;
	message?: { customType: string; content: string; display: boolean };
} {
	return buildPromptModifications(agent, event.systemPrompt);
}