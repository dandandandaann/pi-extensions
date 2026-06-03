import { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BossCheckInPayload } from "./types";
import { getConfig } from "./config";
import { getOpenTasks, getOldestOpenTask } from "./tasks";

export function buildCheckInPayload(
  ctx: ExtensionContext,
  idleMs: number,
  followupNumber: number
): BossCheckInPayload {
  return {
    firedAt: new Date().toISOString(),
    idleMs,
    followupNumber,
    maxFollowups: getConfig().maxFollowups,
    openTaskCount: getOpenTasks(ctx).length,
    oldestOpenTask: getOldestOpenTask(ctx),
  };
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export async function sendBossCheckIn(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  idleMs: number,
  followupNumber: number
): Promise<string> {
  const payload = buildCheckInPayload(ctx, idleMs, followupNumber);

  const oldestTaskPart = payload.oldestOpenTask
    ? `. Oldest: #${payload.oldestOpenTask.id} "${payload.oldestOpenTask.text}"`
    : ``;

  const formattedDirective = `[BOSS CHECK-IN #${payload.followupNumber} — ${payload.firedAt}] Idle: ${formatDuration(idleMs)}. Open tasks: ${payload.openTaskCount}${oldestTaskPart}. Employee has not reported in. Press them for a status. You decide the opening — can be softer on first check-in, harder on subsequent ones — but stay adversarial. Do not take their side. Do not commiserate.`;

  const result = await pi.sendMessage(
    {
      customType: "bossy-boss",
      content: formattedDirective,
      display: true,
      details: payload,
    },
    { deliverAs: "followUp", triggerTurn: true }
  );

  // sendMessage returns void; we don't need to track the entry id
  return undefined;
}