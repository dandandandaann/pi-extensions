/**
 * Bossy Extension — main entry point.
 * Wires together all modules and registers event handlers.
 */
import { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { getConfig, setConfig } from "./config";
import { IdleWatcher } from "./idle-watcher";
import { registerBossCommands } from "./commands";
import { beforeAgentStartHandler } from "./personality";
import { notifyBoss, isBossInitiatedTurn } from "./notifications";
import { setupStatusLine, setupWidget } from "./status";
import { sendBossCheckIn } from "./boss-message";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let bossEnabled = getConfig().bossEnabled;
let currentIdleWatcher: IdleWatcher | undefined;
let statusCleanup: (() => void) | undefined;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function setBossEnabled(enabled: boolean): void {
  bossEnabled = enabled;
  setConfig({ bossEnabled });

  if (!enabled) {
    currentIdleWatcher?.stop();
  } else {
    currentIdleWatcher?.start();
  }
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default (pi: ExtensionAPI): void => {
  // -------------------------------------------------------------------------
  // before_agent_start — inject boss personality into system prompt
  // -------------------------------------------------------------------------
  pi.on("before_agent_start", beforeAgentStartHandler(pi));

  // -------------------------------------------------------------------------
  // agent_start — record activity when agent responds
  // -------------------------------------------------------------------------
  pi.on("agent_start", () => {
    currentIdleWatcher?.noteActivity();
  });

  // -------------------------------------------------------------------------
  // tool_execution_start — record activity on any tool call
  // -------------------------------------------------------------------------
  pi.on("tool_execution_start", () => {
    currentIdleWatcher?.noteActivity();
  });

  // -------------------------------------------------------------------------
  // user_bash — record activity on user bash commands
  // -------------------------------------------------------------------------
  pi.on("user_bash", () => {
    currentIdleWatcher?.noteActivity();
  });

  // -------------------------------------------------------------------------
  // session_start — set up idle watcher, UI, and commands
  // -------------------------------------------------------------------------
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    // Always get config in case it was changed
    const config = getConfig();

    // Create idle watcher with check-in callback
    const watcher = new IdleWatcher(ctx, config, (payload) => {
      if (!bossEnabled) return;

      const idleMs = payload.idleMs;
      const followupNumber = payload.followupNumber;

      // Send the boss check-in message
      sendBossCheckIn(pi, ctx, idleMs, followupNumber);

      // Notify via OS notification only if NOT a boss-initiated turn
      if (!isBossInitiatedTurn(ctx)) {
        notifyBoss(`Check-in #${followupNumber} sent after ${Math.floor(idleMs / 60000)}m idle`);
      }
    });

    currentIdleWatcher = watcher;
    watcher.start();

    // Set up UI only when available
    if (ctx.hasUI) {
      statusCleanup = setupStatusLine(ctx, watcher);
      setupWidget(ctx, watcher);
    }

    // Register slash commands
    registerBossCommands(
      pi,
      ctx,
      () => currentIdleWatcher,
      setBossEnabled
    );
  });

  // -------------------------------------------------------------------------
  // session_shutdown — clean up resources
  // -------------------------------------------------------------------------
  pi.on("session_shutdown", (_event, ctx: ExtensionContext) => {
    currentIdleWatcher?.stop();
    currentIdleWatcher = undefined;

    if (ctx.hasUI) {
      ctx.ui.setStatus("boss-state", undefined);
      ctx.ui.setStatus("boss-task", undefined);
      ctx.ui.setWidget(() => undefined);
    }

    statusCleanup?.();
    statusCleanup = undefined;
  });

  // -------------------------------------------------------------------------
  // message_end — skip notifyBoss for boss-initiated turns
  // (handled inline in session_start callback via isBossInitiatedTurn)
  // -------------------------------------------------------------------------
};