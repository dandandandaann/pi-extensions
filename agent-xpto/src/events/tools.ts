/**
 * Tool call event handler logic
 */

import type { ToolCallEvent } from "@mariozechner/pi-coding-agent";
import type { AgentConfig } from "../types";
import { shouldBlockTool } from "../tools";

/**
 * Handle tool_call event - check if tool should be blocked
 */
export function handleToolCall(
	agent: AgentConfig,
	event: ToolCallEvent
): { block: boolean; reason?: string } | undefined {
	return shouldBlockTool(agent, event.toolName);
}