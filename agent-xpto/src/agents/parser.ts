/**
 * Pure functions for parsing markdown agent files
 * These functions have no side effects and are fully testable
 */

import type { AgentConfig } from "../types";

/**
 * Parsed markdown agent before conversion to AgentConfig
 */
export interface ParsedMarkdownAgent {
	id: string;
	name: string;
	purpose?: string;
	order?: number;
	systemPrompt: string;
	tools: Record<string, boolean>;
	model?: { provider: string; model: string };
	thinkingLevel?: string;
	temperature?: number;
}

/**
 * Parse a model string like "provider/model" into components
 */
export function parseModelString(modelStr: string): { provider: string; model: string } {
	const parts = modelStr.split("/");
	if (parts.length >= 2) {
		return { provider: parts[0], model: parts[1] };
	}
	return { provider: "unknown", model: modelStr };
}

/**
 * Parse YAML front matter from markdown content
 * Handles both CRLF (Windows) and LF (Unix) line endings
 * 
 * @param content - Raw markdown content with optional YAML front matter
 * @returns Object with parsed metadata and body content
 */
export function parseYamlFrontMatter(content: string): { metadata: Record<string, unknown>; body: string } {
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

/**
 * Parse a markdown agent file
 * 
 * @param content - Raw file content
 * @param fileName - Original filename (used to derive ID)
 * @returns Parsed markdown agent or null on error
 */
export function parseMarkdownAgent(content: string, fileName: string): ParsedMarkdownAgent | null {
	try {
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

		const order = metadata.order !== undefined ? parseInt(String(metadata.order), 10) : undefined;

		return {
			id,
			name: String(metadata.name || id),
			purpose: metadata.purpose ? String(metadata.purpose) : undefined,
			order: isNaN(order as number) ? undefined : order,
			systemPrompt: body,
			tools,
			model,
			thinkingLevel: metadata.thinking ? String(metadata.thinking) : undefined,
			temperature: extractTemperature(metadata.temperature),
		};
	} catch (error) {
		console.error("[agents/parser] Failed to parse agent:", fileName, error);
		return null;
	}
}

function extractTemperature(value: unknown): number | undefined {
	if (value === undefined || value === null) return undefined;
	const parsed = parseFloat(String(value));
	return isNaN(parsed) ? undefined : parsed;
}

/**
 * Convert a parsed markdown agent to AgentConfig format
 */
export function convertParsedToAgentConfig(parsed: ParsedMarkdownAgent): AgentConfig {
	return {
		id: parsed.id,
		name: parsed.name,
		purpose: parsed.purpose,
		order: parsed.order,
		systemPrompt: parsed.systemPrompt,
		tools: parsed.tools,
		model: parsed.model,
		thinkingLevel: parsed.thinkingLevel as AgentConfig["thinkingLevel"],
		temperature: parsed.temperature,
	};
}