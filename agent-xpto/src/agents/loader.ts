/**
 * Agent loading from markdown files
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentsDir, getConfigPath } from "../config";
import type { AgentConfig } from "../types";
import { parseMarkdownAgent, convertParsedToAgentConfig } from "./parser";

/**
 * Load all agents from markdown files in the agents directory
 */
export function loadMarkdownAgents(): AgentConfig[] {
	try {
		const agentsDir = getAgentsDir();
		if (!fs.existsSync(agentsDir)) {
			return [];
		}

		const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
		const agents: AgentConfig[] = [];

		for (const file of files) {
			const filePath = path.join(agentsDir, file);
			const content = fs.readFileSync(filePath, "utf-8");
			const parsed = parseMarkdownAgent(content, file);
			if (parsed) {
				agents.push(convertParsedToAgentConfig(parsed));
			}
		}

		return agents;
	} catch (error) {
		console.error("[agents/loader] Failed to load markdown agents:", error);
		return [];
	}
}

/**
 * Load legacy JSON config
 */
function loadConfig(): { agents: AgentConfig[] } | null {
	try {
		const configPath = getConfigPath();
		if (!fs.existsSync(configPath)) {
			return null;
		}
		const content = fs.readFileSync(configPath, "utf-8");
		return JSON.parse(content);
	} catch (error) {
		console.error("[agents/loader] Failed to load config:", error);
		return null;
	}
}

/**
 * Get all configured agents (from markdown files or legacy JSON config)
 */
export function getAgents(): AgentConfig[] {
	const markdownAgents = loadMarkdownAgents();
	if (markdownAgents.length > 0) {
		return markdownAgents;
	}
	const config = loadConfig();
	return config?.agents ?? [];
}

/**
 * Ensure the agents directory exists
 */
export function ensureDirectoryExists(): void {
	const dir = getAgentsDir();
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}