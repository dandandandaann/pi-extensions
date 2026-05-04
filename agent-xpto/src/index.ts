/**
 * Pi Agent Selector Extension - Entry Point
 *
 * A multi-agent system for pi that allows users to create and switch between
 * different specialized agents, each with their own instructions, tool
 * permissions, and model preferences.
 *
 * Features:
 * - Direct prompt routing to selected agent
 * - Hotkey agent selection (Ctrl+Shift+A cycles through agents)
 * - Per-agent tool limitations
 * - Per-agent model preferences
 * - Per-agent thinking level settings
 *
 * Usage:
 * - /agent - Show/select agents
 * - /agents - List all agents
 * - /call <agent-id> <task> - Call another agent with a task
 * - Ctrl+Shift+A - Cycle to next agent
 * - Ctrl+Shift+S - Open agent selector
  */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createAgentSelectorExtension } from "./extension.js";

// Re-export types for external consumers
export type {
	ThinkingLevel,
	ModelConfig,
	AgentTools,
	AgentConfig,
} from "./types/index.js";
export type {
	Message,
	SpawnResult,
	SpawnOptions,
	SpawnUsage,
	SpawnAgentParams,
} from "./types/index.js";

// Re-export extension function
export default function agentSelectorExtension(pi: ExtensionAPI): void {
	createAgentSelectorExtension(pi);
}