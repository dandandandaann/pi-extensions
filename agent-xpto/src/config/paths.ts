/**
 * Path constants and utilities for agent configuration
 */

import * as path from "node:path";
import * as os from "node:os";

/**
 * Root directory for agent configuration
 */
export const AGENT_DIR = path.join(os.homedir(), ".pi", "agent");

/**
 * Subdirectory name for agent markdown files
 */
export const AGENTS_SUBDIR = "agents";

/**
 * Config file name for legacy JSON configuration
 */
export const CONFIG_FILE = "agents.json";

/**
 * Get the agents directory path
 */
export function getAgentsDir(): string {
	return path.join(AGENT_DIR, AGENTS_SUBDIR);
}

/**
 * Get the legacy config file path
 */
export function getConfigPath(): string {
	return path.join(AGENT_DIR, CONFIG_FILE);
}