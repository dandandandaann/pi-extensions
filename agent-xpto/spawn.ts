/**
 * Core spawn mechanism for running agents as subprocesses
 * 
 * This module provides the ability to spawn another agent as a subprocess,
 * collect its JSONL output, and return structured results.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";
import type { Message, SpawnResult, SpawnOptions, SpawnUsage } from "./types/spawn";
import type { AgentConfig } from "./types/agent";

// Re-export types for convenience
export type { Message, SpawnResult, SpawnOptions, SpawnAgentParams } from "./types/spawn";

// ============================================================================
// Constants
// ============================================================================

const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const AGENTS_SUBDIR = "agents";
const CONFIG_FILE = "agents.json";

function getAgentsDir(): string {
	return path.join(AGENT_DIR, AGENTS_SUBDIR);
}

// ============================================================================
// Markdown Agent Loading
// ============================================================================

interface ParsedMarkdownAgent {
	id: string;
	name: string;
	description?: string;
	systemPrompt: string;
	tools: Record<string, boolean>;
	model?: { provider: string; model: string };
	thinkingLevel?: string;
}

function parseModelString(modelStr: string): { provider: string; model: string } {
	const parts = modelStr.split("/");
	if (parts.length >= 2) {
		return { provider: parts[0], model: parts[1] };
	}
	return { provider: "unknown", model: modelStr };
}

function parseYamlFrontMatter(content: string): { metadata: Record<string, unknown>; body: string } {
	// Use \r?\n to handle both CRLF (Windows) and LF (Unix) line endings
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) {
		return { metadata: {}, body: content };
	}

	const yamlContent = match[1];
	const body = match[2].trim();
	const metadata: Record<string, unknown> = {};

	const lines = yamlContent.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const colonIndex = line.indexOf(":");
		if (colonIndex > 0) {
			const key = line.substring(0, colonIndex).trim();
			let value = line.substring(colonIndex + 1).trim();

			if (value === "") {
				// Nested object (like tools section)
				const nestedObj: Record<string, boolean> = {};
				for (let j = i + 1; j < lines.length; j++) {
					const nextLine = lines[j];
					if (nextLine.match(/^\s+[a-z]/)) {
						const itemMatch = nextLine.match(/^\s+([a-z]+):\s*(true|false)?/);
						if (itemMatch) {
							const toolName = itemMatch[1];
							const toolValue = itemMatch[2];
							// Default to true if value not specified, otherwise use the value
							nestedObj[toolName] = toolValue === "false" ? false : true;
						}
					} else if (nextLine.trim() === "") {
						continue;
					} else {
						break;
					}
				}
				if (Object.keys(nestedObj).length > 0) {
					metadata[key] = nestedObj;
				}
			} else {
				if (value === "true") metadata[key] = true;
				else if (value === "false") metadata[key] = false;
				else metadata[key] = value;
			}
		}
	}

	return { metadata, body };
}

function parseMarkdownAgent(filePath: string, fileName: string): ParsedMarkdownAgent | null {
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		const { metadata, body } = parseYamlFrontMatter(content);

		const id = fileName.replace(/\.md$/i, "");

		const tools: Record<string, boolean> = {};
		if (metadata.tools && typeof metadata.tools === "object") {
			for (const [tool, enabled] of Object.entries(metadata.tools)) {
				tools[tool] = enabled === true;
			}
		}

		const model: { provider: string; model: string } | undefined = metadata.model
			? parseModelString(String(metadata.model))
			: undefined;

		return {
			id,
			name: String(metadata.name || id),
			description: metadata.description ? String(metadata.description) : undefined,
			systemPrompt: body,
			tools,
			model,
			thinkingLevel: metadata.thinking ? String(metadata.thinking) : undefined,
		};
	} catch (error) {
		console.error("[spawn] Failed to parse agent file", filePath, ":", error);
		return null;
	}
}

function convertParsedToAgentConfig(parsed: ParsedMarkdownAgent): AgentConfig {
	return {
		id: parsed.id,
		name: parsed.name,
		description: parsed.description,
		systemPrompt: parsed.systemPrompt,
		tools: parsed.tools,
		model: parsed.model,
		thinkingLevel: parsed.thinkingLevel as AgentConfig["thinkingLevel"],
	};
}

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
			const parsed = parseMarkdownAgent(filePath, file);
			if (parsed) {
				agents.push(convertParsedToAgentConfig(parsed));
			}
		}

		console.log(`[spawn] Loaded ${agents.length} agents from ${agentsDir}`);
		return agents;
	} catch (error) {
		console.error("[spawn] Failed to load markdown agents:", error);
		return [];
	}
}

// ============================================================================
// Config Loading
// ============================================================================

function getConfigPath(): string {
	return path.join(AGENT_DIR, CONFIG_FILE);
}

function loadConfig(): { agents: AgentConfig[] } | null {
	try {
		const configPath = getConfigPath();
		if (!fs.existsSync(configPath)) {
			return null;
		}
		const content = fs.readFileSync(configPath, "utf-8");
		return JSON.parse(content);
	} catch (error) {
		console.error("[spawn] Failed to load config:", error);
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
 * Find an agent by ID or name
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
 * Find an agent by ID
 */
export function getAgentById(id: string): AgentConfig | undefined {
	const agents = getAgents();
	return agents.find((a) => a.id === id);
}

// ============================================================================
// Pi Command Resolution
// ============================================================================

/**
 * Resolve the pi CLI script path on Windows
 */
function resolvePiCliPath(): string | undefined {
	try {
		// Try to resolve from process.argv[1]
		const entry = process.argv[1];
		if (entry && fs.existsSync(entry)) {
			const realPath = fs.realpathSync(entry);
			if (/\.(?:mjs|cjs|js)$/i.test(realPath)) {
				return realPath;
			}
		}

		// Try npm global package
		const npmRoot = process.env.APPDATA?.replace("\Roaming", "\Local") 
			?? path.join(os.homedir(), "AppData", "Local");
		const piPackageJson = path.join(npmRoot, "npm", "node_modules", "@mariozechner", "pi-coding-agent", "package.json");
		
		if (fs.existsSync(piPackageJson)) {
			const pkg = JSON.parse(fs.readFileSync(piPackageJson, "utf-8"));
			const binField = pkg.bin;
			const binPath = typeof binField === "string" 
				? binField 
				: binField?.pi ?? Object.values(binField ?? {})[0];
			if (binPath) {
				return path.resolve(path.dirname(piPackageJson), binPath);
			}
		}
	} catch {}
	return undefined;
}

/**
 * Get the pi spawn command
 */
function getPiSpawnCommand(args: string[]): { command: string; args: string[] } {
	const platform = process.platform;
	if (platform === "win32") {
		const piCliPath = resolvePiCliPath();
		if (piCliPath) {
			return {
				command: process.execPath,
				args: [piCliPath, ...args],
			};
		}
	}
	return { command: "pi", args };
}

// ============================================================================
// Argument Building
// ========
