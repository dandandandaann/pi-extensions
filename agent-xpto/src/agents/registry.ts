/**
 * Agent registry for looking up agents by ID or name
 */

import { getAgents } from "./loader";
import type { AgentConfig } from "../types";

/**
 * Find an agent by ID or name
 * First tries to match by ID, then falls back to name
 */
export function getAgentByIdOrName(idOrName: string): AgentConfig | undefined {
	const agents = getAgents();
	// First try by ID
	let agent = agents.find((a) => a.id === idOrName);
	if (agent) return agent;
	// Fall back to name
	agent = agents.find((a) => a.name === idOrName);
	return agent;
}

/**
 * Find an agent by ID only
 */
export function getAgentById(id: string): AgentConfig | undefined {
	const agents = getAgents();
	return agents.find((a) => a.id === id);
}