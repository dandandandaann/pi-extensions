/**
 * Spawn-related type definitions for agent spawning
 */

/**
 * Message format from child agent (JSONL output)
 */
export interface Message {
	role: "user" | "assistant" | "system" | "tool";
	content: string;
	toolCalls?: Array<{ name: string; input: Record<string, unknown> }>;
	toolResults?: Array<{ toolUseId: string; content: string }>;
}

/**
 * Usage statistics from a spawn run
 */
export interface SpawnUsage {
	input: number;
	output: number;
	turns: number;
}

/**
 * Result from spawning an agent
 */
export interface SpawnResult {
	agent: string;
	task: string;
	exitCode: number;
	messages?: Message[];
	usage: SpawnUsage;
	error?: string;
	finalOutput?: string;
}

/**
 * Options for spawning an agent
 */
export interface SpawnOptions {
	cwd?: string;
	signal?: AbortSignal;
	runId: string;
	sessionDir?: string;
}

/**
 * Parameters for spawning a sub-agent
 */
export interface SpawnAgentParams {
	agent: string;
	task: string;
	model?: string;
}