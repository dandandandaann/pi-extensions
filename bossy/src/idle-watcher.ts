import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BossConfig, BossCheckInPayload, TodoSnapshot } from "./types";
import { getTodoSnapshot } from "./tasks";

/**
 * Core timer logic for Bossy idle detection and follow-up scheduling.
 * Manages the idle threshold timer and escalating check-in follow-ups.
 */
export class IdleWatcher {
  private lastActivityAt: number;
  private followupsSentInPeriod: number;
  private currentPeriodStartedAt: number;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private ctx: ExtensionContext,
    private config: BossConfig,
    private onCheckInDue: (payload: BossCheckInPayload) => void
  ) {
    this.lastActivityAt = Date.now();
    this.followupsSentInPeriod = 0;
    this.currentPeriodStartedAt = Date.now();
  }

  /** Record user activity. Resets follow-up counter and re-arms timer. */
  noteActivity(): void {
    this.lastActivityAt = Date.now();
    this.followupsSentInPeriod = 0;
    this.scheduleNext();
  }

  /** Start the idle detection timer from last activity. */
  start(): void {
    this.scheduleNext();
  }

  /** Stop the idle timer. */
  stop(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** Force a check-in immediately (as followup #1). Auto-starts watcher if stopped. */
  forceCheckIn(): void {
    // Auto-start if watcher was stopped (boss may be re-enabling)
    this.start();

    // Increment the follow-up counter (like fireCheckIn does)
    this.followupsSentInPeriod += 1;

    // Check if max follow-ups exceeded
    if (this.followupsSentInPeriod > this.config.maxFollowups) {
      return;
    }

    const payload = this.buildPayload(this.followupsSentInPeriod);
    this.onCheckInDue(payload);

    // Schedule next follow-up
    this.scheduleNext();
  }

  /** Expose last activity timestamp for status display. */
  getLastActivityAt(): number {
    return this.lastActivityAt;
  }

  /** Expose follow-up count for status display. */
  getFollowupsSent(): number {
    return this.followupsSentInPeriod;
  }

  /** Compute when the next check-in is scheduled to fire. */
  getNextCheckInAt(): number {
    const delay =
      this.followupsSentInPeriod === 0
        ? this.config.idleThresholdMs
        : this.config.followupIntervalMs;
    return this.lastActivityAt + delay;
  }

  /** Schedule the next check-in based on current state. */
  private scheduleNext(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    const delay =
      this.followupsSentInPeriod === 0
        ? this.config.idleThresholdMs
        : this.config.followupIntervalMs;

    this.timer = setTimeout(() => this.fireCheckIn(), delay);
  }

  /** Fire a check-in and schedule the next follow-up if applicable. */
  private fireCheckIn(): void {
    this.followupsSentInPeriod += 1;

    if (this.followupsSentInPeriod > this.config.maxFollowups) {
      // Max follow-ups reached, stop firing
      return;
    }

    const payload = this.buildPayload(this.followupsSentInPeriod);
    this.onCheckInDue(payload);

    // Schedule next follow-up
    this.scheduleNext();
  }

  /** Build the check-in payload from current state. */
  private buildPayload(followupNumber: number): BossCheckInPayload {
    const now = Date.now();
    const idleMs = now - this.lastActivityAt;
    const snapshot: TodoSnapshot = getTodoSnapshot(this.ctx);

    const oldestOpenTask =
      snapshot.open.length > 0
        ? { id: snapshot.open[0].id, text: snapshot.open[0].text }
        : null;

    return {
      kind: "check-in",
      firedAt: new Date(now).toISOString(),
      idleMs,
      followupNumber,
      maxFollowups: this.config.maxFollowups,
      openTaskCount: snapshot.open.length,
      oldestOpenTask,
    };
  }
}
