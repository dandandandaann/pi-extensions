/**
 * Agent state manager for tracking current agent and switching
 */

import type { AgentConfig } from "../types";
import { getAgents } from "./loader";

/**
 * Agent state manager class
 * Manages current agent index, switching, and cycling through agents
 */
export class AgentStateManager {
	private agents: AgentConfig[];
	private currentIndex: number;

	/**
	 * Create a new agent state manager
	 * @param agents - Initial list of agents (defaults to loading from disk)
	 */
	constructor(agents?: AgentConfig[]) {
		this.agents = agents ?? getAgents();
		this.currentIndex = this.agents.length > 0 ? 0 : -1;
	}

	/**
	 * Get the current agent
	 */
	getCurrentAgent(): AgentConfig | null {
		if (this.currentIndex < 0 || this.currentIndex >= this.agents.length) {
			return null;
		}
		return this.agents[this.currentIndex];
	}

	/**
	 * Switch to an agent by ID
	 * @returns The new agent if found, null otherwise
	 */
	switchToAgent(agentId: string): AgentConfig | null {
		const index = this.agents.findIndex((a) => a.id === agentId);
		if (index >= 0) {
			this.currentIndex = index;
			return this.getCurrentAgent();
		}
		return null;
	}

	/**
	 * Switch to an agent by index
	 */
	switchToIndex(index: number): AgentConfig | null {
		if (index >= 0 && index < this.agents.length) {
			this.currentIndex = index;
			return this.getCurrentAgent();
		}
		return null;
	}

	/**
	 * Cycle to the next agent
	 * @param wrap - Whether to wrap around to the first agent (default: true)
	 */
	cycleAgent(wrap: boolean = true): AgentConfig | null {
		if (this.agents.length === 0) {
			return null;
		}
		this.currentIndex = (this.currentIndex + 1) % this.agents.length;
		return this.getCurrentAgent();
	}

	/**
	 * Get all loaded agents
	 */
	getAgents(): AgentConfig[] {
		return [...this.agents];
	}

	/**
	 * Get the current agent index
	 */
	getCurrentIndex(): number {
		return this.currentIndex;
	}

	/**
	 * Refresh agents from disk
	 */
	refresh(): void {
		this.agents = getAgents();
		if (this.currentIndex >= this.agents.length) {
			this.currentIndex = this.agents.length > 0 ? this.agents.length - 1 : -1;
		}
	}

	/**
	 * Check if any agents are loaded
	 */
	hasAgents(): boolean {
		return this.agents.length > 0;
	}
}