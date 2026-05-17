/**
 * Argument building for agent spawning
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/**
 * Build command line arguments for spawning an agent
 */
export function buildAgentArgs(params: {
	task: string;
	systemPrompt?: string;
	model?: { provider: string; model: string };
	tools?: Record<string, boolean | undefined>;
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