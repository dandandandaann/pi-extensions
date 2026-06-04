/**
 * Centralized configuration for Bossy extension.
 * Reads env vars and exposes a mutable config store.
 */

import { BossConfig } from "./types";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: BossConfig = {
  idleThresholdMs: 30 * 60 * 1000,   // 30 minutes
  followupIntervalMs: 10 * 60 * 1000, // 10 minutes
  maxFollowups: 3,
  bossEnabled: false,
  escalationStyle: "adversarial",
};

// ---------------------------------------------------------------------------
// Module-level mutable store
// ---------------------------------------------------------------------------

let currentConfig: BossConfig = loadConfig();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read BOSSY_* env vars and merge over defaults.
 * Env vars take precedence.
 */
export function loadConfig(): BossConfig {
  const idleMs = process.env.BOSSY_IDLE_MS;
  const followupMs = process.env.BOSSY_FOLLOWUP_MS;
  const maxFollowups = process.env.BOSSY_MAX_FOLLOWUPS;
  const disabled = process.env.BOSSY_DISABLED;

  return {
    ...DEFAULT_CONFIG,
    ...(idleMs !== undefined ? { idleThresholdMs: Number(idleMs) } : {}),
    ...(followupMs !== undefined ? { followupIntervalMs: Number(followupMs) } : {}),
    ...(maxFollowups !== undefined ? { maxFollowups: Number(maxFollowups) } : {}),
    ...(disabled === "1" ? { bossEnabled: false } : {}),
  };
}

/**
 * Mutate the in-memory config in place.
 */
export function setConfig(patch: Partial<BossConfig>): void {
  Object.assign(currentConfig, patch);
}

/**
 * Return a defensive copy of the current config.
 */
export function getConfig(): BossConfig {
  return { ...currentConfig };
}

export { currentConfig };