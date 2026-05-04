/**
 * Barrel export for config module
 */

export { AGENT_DIR, AGENTS_SUBDIR, CONFIG_FILE, getAgentsDir, getConfigPath } from "./paths.js";
export { DEFAULT_SYSTEM_PROMPT_HEADER } from "./prompts.js";
export { type AgentSettings, DEFAULT_SETTINGS, type AgentsConfig } from "./settings.js";