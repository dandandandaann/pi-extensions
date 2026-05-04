/**
 * Pure functions for parsing JSONL output from agent spawning
 * These functions have no side effects and are fully testable
 */

import type { Message, SpawnUsage } from "../types";

/**
 * Parsed markdown agent before conversion to AgentConfig
 */
export interface ParsedMarkdownAgent {
	id: string;
	name: string;
	purpose?: string;
	systemPrompt: string;
	tools: Record<string, boolean>;
	model?: { provider: string; model: string };
	thinkingLevel?: string;
}

/**
 * Parse a single JSONL line
 * Handles various pi JSONL event formats
 */
export function parseJsonlLine(line: string): Message | null {
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
 * Collect messages from JSONL lines
 * Accumulates streaming text from content_block_delta events
 */
export function collectMessages(lines: string[]): Message[] {
	const messages: Message[] = [];
	const textChunks: string[] = [];
	let lastRole = "";

	for (const line of lines) {
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

/**
 * Extract final output from messages
 * Looks for the last assistant message with substantial content
 */
export function extractFinalOutput(messages: Message[]): string | undefined {
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
 */
export function calculateUsage(messages: Message[]): SpawnUsage {
	return {
		input: 0,
		output: 0,
		turns: messages.filter((m) => m.role === "assistant").length,
	};
}