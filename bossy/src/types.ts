/**
 * Shared TypeScript types for Bossy extension.
 * No pi imports - this file is dependency-free.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface BossConfig {
  /** ms of no activity before first check-in (default 30 min) */
  idleThresholdMs: number;
  /** ms between follow-ups (default 10 min) */
  followupIntervalMs: number;
  /** max follow-ups per idle period (default 3) */
  maxFollowups: number;
  /** global kill switch */
  bossEnabled: boolean;
  /** placeholder for future styles */
  escalationStyle: "adversarial";
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface IdleState {
  /** Date.now() of last activity */
  lastActivityAt: number;
  /** counter that resets on user response */
  followupsSentInPeriod: number;
  /** when this idle period began */
  currentPeriodStartedAt: number;
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

export interface BossCheckInPayload {
  kind: "check-in";
  /** ISO timestamp */
  firedAt: string;
  /** exact idle duration in ms */
  idleMs: number;
  /** 1 for first, 2/3 for follow-ups */
  followupNumber: number;
  /** cap */
  maxFollowups: number;
  /** number of open tasks at time of check-in */
  openTaskCount: number;
  /** oldest incomplete task at time of check-in */
  oldestOpenTask: { id: number; text: string } | null;
}

// ---------------------------------------------------------------------------
// Todo
// ---------------------------------------------------------------------------

/** Mirrors the core todo shape from todo.ts */
export interface Todo {
  id: number;
  text: string;
  done: boolean;
}

/** Snapshot of todo list state at a point in time */
export interface TodoSnapshot {
  open: Array<{ id: number; text: string; done: false }>;
  allDone: boolean;
}