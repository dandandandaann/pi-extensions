/**
 * Pure function for determining if a tool should be blocked
 */

import type { AgentConfig } from "../types";

/**
 * Check if a tool should be blocked for an agent
 * @returns Object with block flag and optional reason
 */
export function shouldBlockTool(agent: AgentConfig, toolName: string): { block: boolean; reason?: string } {
	// Check if tool is explicitly disabled
	if (agent.tools[toolName] === false) {
		return {
			block: true,
			reason: `${agent.name} agent cannot use \`${toolName}\` tool. This tool is disabled for this agent.`,
		};
	}
	return { block: false };
}