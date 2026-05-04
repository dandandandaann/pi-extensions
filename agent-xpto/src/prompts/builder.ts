/**
 * Pure functions for building system prompts
 * These functions have no side effects and are fully testable
 */

import type { AgentConfig } from "../types";
import { DEFAULT_SYSTEM_PROMPT_HEADER } from "../config";

/**
 * Build a list of enabled tools for an agent
 */
export function buildCapabilityList(agent: AgentConfig): string {
	const enabledTools = Object.entries(agent.tools)
		.filter(([, enabled]) => enabled === true)
		.map(([tool]) => tool);

	if (enabledTools.length === 0) {
		return "No tools enabled.";
	}

	return `Enabled tools: ${enabledTools.join(", ")}.`;
}

/**
 * Build a list of tool restrictions for an agent
 */
export function buildRestrictionList(agent: AgentConfig): string {
	const disabledTools = Object.entries(agent.tools)
		.filter(([, enabled]) => enabled === false)
		.map(([tool]) => tool);

	if (disabledTools.length === 0) {
		return "No restrictions.";
	}

	return `Disabled tools: ${disabledTools.join(", ")}. You CANNOT use these tools.`;
}

/**
 * Build the full agent system prompt with header
 */
export function buildAgentSystemPrompt(agent: AgentConfig): string {
	const header = DEFAULT_SYSTEM_PROMPT_HEADER
		.replace("{agentName}", agent.name)
		.replace("{agentPurpose}", agent.systemPrompt || agent.purpose || "Specialized agent")
		.replace("{capabilities}", buildCapabilityList(agent))
		.replace("{restrictions}", buildRestrictionList(agent));

	return header.trim();
}