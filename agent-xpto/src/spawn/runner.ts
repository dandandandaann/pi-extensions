/**
 * Core spawn runner for executing agents as subprocesses
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as readline from "node:readline";
import type { SpawnResult, SpawnOptions } from "../types";
import { getAgentById } from "../agents";
import { getPiSpawnCommand } from "./cli";
import { buildAgentArgs } from "./args";
import { collectMessages, extractFinalOutput, calculateUsage } from "./parser";

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
	const agent = getAgentById(agentId);

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
		tools: agent.tools as Record<string, boolean | undefined>,
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

	// Collect output lines
	const lines: string[] = [];
	const rl = readline.createInterface({
		input: proc.stdout!,
		crlfDelay: Infinity,
	});

	for await (const line of rl) {
		lines.push(line);
	}

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

	// Parse collected lines into messages
	const messages = collectMessages(lines);

	// Debug: log if no output collected
	if (messages.length === 0) {
		console.error("[spawn/runner] No messages collected from agent output");
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