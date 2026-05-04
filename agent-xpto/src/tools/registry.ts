/**
 * Pure function for getting enabled tool names
 */

import type { AgentConfig } from "../types";

/**
 * Get list of enabled tool names for an agent
 */
export function getEnabledToolNames(agent: AgentConfig): string[] {
	return Object.entries(agent.tools)
		.filter(([, enabled]) => enabled === true)
		.map(([tool]) => tool);
}