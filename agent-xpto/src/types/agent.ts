/**
 * Shared type definitions for agent-xpto extension
 */

/**
 * Tool permissions for an agent
 */
export interface AgentTools {
	read?: boolean;
	write?: boolean;
	edit?: boolean;
	bash?: boolean;
	grep?: boolean;
	find?: boolean;
	[toolName: string]: boolean | undefined;
}

/**
 * Model configuration
 */
export interface ModelConfig {
	provider: string;
	model: string;
}

/**
 * Thinking level for an agent
 */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/**
 * Agent configuration
 */
export interface AgentConfig {
	id: string;
	name: string;
	order?: number;
	purpose?: string;
	systemPrompt?: string;
	tools: AgentTools;
	model?: ModelConfig;
	thinkingLevel?: ThinkingLevel;
	temperature?: number;
}