/**
 * Status line and widget integration for Bossy.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { IdleWatcher } from "./idle-watcher";
import { getConfig } from "./config";
import { getOpenTasks, getOldestOpenTask } from "./tasks";

/**
 * Format an idle duration in milliseconds to a human-readable string.
 * e.g. 1832000 → "30m 32s"
 */
export function formatIdleDuration(lastActivityAt: number): string {
  const elapsed = Date.now() - lastActivityAt;
  const totalSeconds = Math.floor(elapsed / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * Format a future time as "in Xm Ys", or just "in Xm" if < 60s.
 */
function formatTimeUntil(timestampMs: number): string {
  const diff = timestampMs - Date.now();
  if (diff <= 0) return "now";
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `in ${seconds}s`;
  return seconds > 0 ? `in ${minutes}m ${seconds}s` : `in ${minutes}m`;
}

/**
 * Set up the status line entries for Bossy.
 * Returns a cleanup function to remove the status keys.
 */
export function setupStatusLine(
  ctx: ExtensionContext,
  idleWatcher: IdleWatcher
): () => void {
  if (!ctx.hasUI) return () => {};

  let intervalId: ReturnType<typeof setInterval> | undefined;

  function recomputeStatus() {
    const config = getConfig();
    const openTasks = getOpenTasks(ctx);

    // boss-state
    let bossState: string;
    if (!config.bossEnabled) {
      bossState = "";
    } else {
      const idle = formatIdleDuration(idleWatcher.getLastActivityAt());
      if (openTasks.length === 0) {
        bossState = " | Bossy: idle · no open tasks";
      } else {
        // next check-in time
        const nextCheckIn = formatTimeUntil(idleWatcher.getNextCheckInAt());
        bossState = ` | Bossy: ${openTasks.length} open · idle ${idle} · next in ${nextCheckIn}`;
      }
    }
    ctx.ui.setStatus("boss-state", bossState);

    // boss-task — oldest open task
    const oldest = getOldestOpenTask(ctx);
    if (oldest) {
      ctx.ui.setStatus("boss-task", `#${oldest.id} ${oldest.text}`);
    } else {
      ctx.ui.setStatus("boss-task", "");
    }
  }

  intervalId = setInterval(recomputeStatus, 1000);

  return () => {
    if (intervalId !== undefined) clearInterval(intervalId);
    ctx.ui.setStatus("boss-state", undefined);
    ctx.ui.setStatus("boss-task", undefined);
  };
}

/**
 * Set up the widget for Bossy.
 * Displays open tasks, idle duration, and follow-up state.
 */
export function setupWidget(
  ctx: ExtensionContext,
  idleWatcher: IdleWatcher
): void {
  if (!ctx.hasUI) return;

  ctx.ui.setWidget(() => {
    const config = getConfig();
    if (!config.bossEnabled) {
      return undefined;
    }

    const openTasks = getOpenTasks(ctx);
    const oldest = getOldestOpenTask(ctx);
    const idle = formatIdleDuration(idleWatcher.getLastActivityAt());
    const sent = idleWatcher.getFollowupsSent();
    const max = config.maxFollowups;

    const lines: Array<{ text: string; color?: string }> = [];

    if (oldest) {
      lines.push({ text: `[${oldest.id}] ${oldest.text}` });
    } else {
      lines.push({ text: "No open tasks", color: ctx.ui.theme.dim });
    }

    lines.push({ text: `Idle: ${idle}` });

    if (sent > 0) {
      lines.push({ text: `Follow-ups: ${sent}/${max}` });
    } else {
      const nextCheckIn = formatTimeUntil(idleWatcher.getNextCheckInAt());
      lines.push({ text: `Next check-in: ${nextCheckIn}` });
    }

    return {
      location: "aboveEditor",
      lines,
    };
  });
}