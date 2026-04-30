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
// ============================================================================

/**
 * Build command line arguments for spawning an agent
 */
function buildAgentArgs(params: {
	task: string;
	systemPrompt?: string;
	model?: { provider: string; model: string };
	tools?: Record<string, boolean>;
}): string[] {
	const args: string[] = ["--mode", "json", "--no-session", "-p", params.task];

	if (params.systemPrompt) {
		// Write system prompt to temp file to avoid command line length limits
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-agent-call-"));
		const promptPath = path.join(tempDir, "prompt.md");
		fs.writeFileSync(promptPath, params.systemPrompt, { mode: 0o600 });
		args.push("--system-prompt", promptPath);
	}

	if (params.model) {
		args.push("--model", `${params.model.provider}/${params.model.model}`);
	}

	if (params.tools) {
		const enabledTools = Object.entries(params.tools)
			.filter(([, enabled]) => enabled === true)
			.map(([tool]) => tool);
		if (enabledTools.length > 0) {
			args.push("--tools", enabledTools.join(","));
		}
	}

	return args;
}

// ============================================================================
// JSONL Parsing
// ============================================================================

/**
 * Parse a single JSONL line
 * Handles various pi JSONL event formats
 */
function parseJsonlLine(line: string): Message | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	try {
		const parsed = JSON.parse(trimmed);
		
		// Handle pi's JSONL format where messages are nested in .message field
		// e.g., {"type":"message_end","message":{"role":"assistant","content":[...]}}
		if (parsed?.message && typeof parsed.message === "object") {
			return parsed.message as Message;
		}
		
		// Handle direct message format ({"role": "...", "content": [...]})
		if (parsed?.role) {
			return parsed as Message;
		}
		
		// Handle content_block events that contain text
		// e.g., {"type":"content_block_delta","content_block":{"type":"text","text":"..."}}
		if (parsed?.content_block?.text) {
			return {
				role: "assistant",
				content: parsed.content_block.text,
			} as Message;
		}
		
		// Handle message_update events with content
		// e.g., {"type":"message_update","message":{"content":[...]}}
		if (parsed?.type === "message_update" && parsed?.message) {
			return parsed.message as Message;
		}
		
		// Handle delta events with text content
		// e.g., {"type":"content_block_delta","delta":{"type":"text","text":"..."}}
		if (parsed?.delta?.text) {
			return {
				role: "assistant",
				content: parsed.delta.text,
			} as Message;
		}
		
		return null;
	} catch {
		return null;
	}
}

/**
 * Collect messages from stdout stream
 * Accumulates streaming text from content_block_delta events
 */
async function collectMessages(stdout: NodeJS.ReadableStream): Promise<Message[]> {
	const messages: Message[] = [];
	const textChunks: string[] = [];
	let lastRole = "";
	
	const rl = readline.createInterface({
		input: stdout as NodeJS.ReadableStream,
		crlfDelay: Infinity,
	});

	for await (const line of rl) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		
		try {
			const parsed = JSON.parse(trimmed);
			
			// Check for content_block_delta events - accumulate text
			if (parsed?.type === "content_block_delta") {
				// Handle both content_block.text and delta.text formats
				const text = parsed?.content_block?.text || parsed?.delta?.text;
				if (text) {
					textChunks.push(text);
				}
				continue;
			}
			
			// Check for message start to capture role
			if (parsed?.type === "message_start" && parsed?.message?.role) {
				lastRole = parsed.message.role;
			}
			
			// Flush accumulated text chunks when we see message_end
			if (parsed?.type === "message_end" && textChunks.length > 0) {
				messages.push({
					role: lastRole || "assistant",
					content: textChunks.join(""),
				} as Message);
				textChunks.length = 0; // Clear for next message
			}
			
			// Handle other message formats
			if (parsed?.message && typeof parsed.message === "object") {
				const msg = parsed.message as Message;
				if (msg.role) {
					messages.push(msg);
				}
			} else if (parsed?.role) {
				messages.push(parsed as Message);
			}
		} catch {
			// Skip malformed lines
		}
	}

	// Flush any remaining text chunks at end of stream
	if (textChunks.length > 0) {
		messages.push({
			role: lastRole || "assistant",
			content: textChunks.join(""),
		} as Message);
	}

	return messages;
}

// ============================================================================
// Result Extraction
// ============================================================================

/**
 * Extract final output from messages
 * Looks for the last assistant message with substantial content
 */
function extractFinalOutput(messages: Message[]): string | undefined {
	if (messages.length === 0) return undefined;

	// Find the last assistant message with content
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			// Support multiple content field locations:
			// - Direct .content (simple string)
			// - message.content (from message_update events)
			// - .content array with blocks (from message_end events)
			const rawContent = (msg as any).content ?? (msg as any).text ?? (msg as any).message ?? (msg as any).output;
			
			// Handle content array (e.g., [{type: "text", text: "..."}, ...])
			if (Array.isArray(rawContent)) {
				const textParts: string[] = [];
				for (const block of rawContent) {
					if (typeof block === "string") {
						textParts.push(block);
					} else if (block?.type === "text" && block?.text) {
						textParts.push(block.text);
					} else if (block?.type === "thinking" && block?.thinking) {
						// Skip thinking blocks
					} else if (block?.text) {
						textParts.push(block.text);
					}
				}
				const combined = textParts.join("\n").trim();
				if (combined) return combined;
			}
			
			// Handle direct string content
			if (typeof rawContent === "string" && rawContent.trim()) {
				return rawContent.trim();
			}
			
			// Handle object with text field
			if (typeof rawContent === "object" && rawContent?.text) {
				return String(rawContent.text).trim();
			}
		}
	}

	return undefined;
}

/**
 * Calculate usage from messages
 * This is a simplified version - real usage tracking would need provider-specific parsing
 */
function calculateUsage(messages: Message[]): SpawnUsage {
	return {
		input: 0,
		output: 0,
		turns: messages.filter((m) => m.role === "assistant").length,
	};
}

// ============================================================================
// Core Spawn Function
// ============================================================================

/**
 * Run an agent synchronously and return the result
 * @param agentId - The ID of the agent to run
 * @param task - The task to give the agent
 * @param options - Spawn options including AbortSignal
 */
export async function runSync(
	agentId: string,
	task: string,
	options: SpawnOptions = { runId: "" }
): Promise<SpawnResult> {
	const agents = getAgents();
	const agent = agents.find((a) => a.id === agentId);

	if (!agent) {
		return {
			agent: agentId,  // Return ID in error since we couldn't find the agent
			task,
			exitCode: 1,
			usage: { input: 0, output: 0, turns: 0 },
			error: `Unknown agent: ${agentId}`,
		};
	}

	// Build arguments using agent's actual config
	const args = buildAgentArgs({
		task,
		systemPrompt: agent.systemPrompt,
		model: agent.model,
		tools: agent.tools,
	});

	// Get spawn command
	const { command, args: spawnArgs } = getPiSpawnCommand(args);

	// Spawn child process
	const proc: ChildProcess = spawn(command, spawnArgs, {
		cwd: options.cwd,
		stdio: ["ignore", "pipe", "pipe"],
	});

	// Handle abort signal
	if (options.signal) {
		options.signal.addEventListener("abort", () => {
			if (!proc.killed) {
				proc.kill("SIGTERM");
			}
		}, { once: true });
	}

	// Collect output using streaming parser
	const messages = await collectMessages(proc.stdout!);

	// Wait for process to complete
	const exitCode = await new Promise<number>((resolve) => {
		proc.on("close", (code) => {
			resolve(code ?? 1);
		});
		// Fallback timeout after 5 minutes
		setTimeout(() => {
			if (!proc.killed) {
				proc.kill("SIGTERM");
				resolve(124);
			}
		}, 5 * 60 * 1000);
	});

	// Debug: log if no output collected
	if (messages.length === 0) {
		console.error("[spawn] No messages collected from agent output");
	}

	const usage = calculateUsage(messages);
	const finalOutput = extractFinalOutput(messages);

	return {
		agent: agent.name,  // Use name for display in result
		task,
		exitCode,
		messages,
		usage,
		finalOutput,
		error: exitCode !== 0 && !finalOutput ? `Process exited with code ${exitCode}` : undefined,
	};
}

/**
 * Format spawn result as structured text for parent agent
 */
export function formatSpawnResult(result: SpawnResult): string {
	const lines: string[] = [];
	lines.push(`[Agent: ${result.agent} | Task: ${result.task}]`);

	if (result.error) {
		lines.push(`Result: Error: ${result.error}`);
	} else if (result.finalOutput) {
		lines.push(`Result: ${result.finalOutput}`);
	} else {
		lines.push("Result: No output");
	}

	lines.push("---");
	lines.push(`Exit: ${result.exitCode}`);

	return lines.join("\n");
}
