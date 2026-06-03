/**
 * CLI-style commands for Bossy.
 * All commands live under the /boss namespace.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { IdleWatcher } from "./idle-watcher";
import { Text, matchesKey, Key } from "@earendil-works/pi-tui";
import { getOpenTasks } from "./tasks";
import { formatIdleDuration } from "./status";
import { notifyBoss } from "./notifications";
import { getConfig, setConfig } from "./config";

/**
 * Register all /boss commands on pi.
 */
export function registerBossCommands(
  pi: any,
  ctx: ExtensionContext,
  getIdleWatcher: () => IdleWatcher | undefined,
  setBossEnabled: (enabled: boolean) => void
): void {
  // Helper: ensure we have a watcher, or show an error
  function requireWatcher(): IdleWatcher {
    const w = getIdleWatcher();
    if (!w) {
      if (ctx.hasUI) {
        ctx.ui.notify("Boss watcher is not active.", "error");
      } else {
        notifyBoss("Boss watcher is not active.");
      }
      throw new Error("No idle watcher");
    }
    return w;
  }

  // -------------------------------------------------------------------------
  // Handler functions (extracted from original separate commands)
  // -------------------------------------------------------------------------

  async function handleBossPanel(): Promise<void> {
    if (!ctx.hasUI) {
      notifyBoss("Boss is running. Use interactive mode for full panel.");
      return;
    }

    const openTasks = getOpenTasks(ctx);
    const watcher = getIdleWatcher();

    const lines: string[] = [];

    if (openTasks.length === 0) {
      lines.push("No open tasks");
    } else {
      for (const task of openTasks) {
        lines.push(`[${task.id}] ${task.text}`);
      }
    }

    if (watcher) {
      const idle = formatIdleDuration(watcher.getLastActivityAt());
      lines.push(`Idle: ${idle}`);
      const sent = watcher.getFollowupsSent();
      const max = getConfig().maxFollowups;
      const status =
        sent > 0 ? `${sent}/${max} follow-ups sent` : "awaiting first check-in";
      lines.push(`Follow-ups: ${status}`);
    } else {
      lines.push("Boss watcher inactive");
    }

    lines.push("Press Enter to check in now · Esc to close");

    await ctx.ui.custom<boolean>((tui, theme, _kb, done) => {
      const content = lines.join("\n");
      const textComponent = new Text(content, 1, 1);
      let closed = false;
      const safeDone = (result: boolean) => {
        if (closed) return;
        closed = true;
        done(result);
      };

      return {
        render(width: number): string[] {
          return textComponent.render(width);
        },
        invalidate(): void {
          textComponent.invalidate();
        },
        handleInput(data: string): void {
          if (matchesKey(data, Key.enter)) {
            try {
              requireWatcher().forceCheckIn();
              ctx.ui.notify("Check-in sent!", "info");
            } catch {
              // already notified inside requireWatcher
            }
            safeDone(true);
          } else if (matchesKey(data, Key.escape)) {
            safeDone(false);
          }
        },
      };
    });
  }

  function handleBossOn(): void {
    setBossEnabled(true);
    const watcher = getIdleWatcher();
    if (watcher) {
      watcher.start();
    }
    if (ctx.hasUI) {
      ctx.ui.notify("Boss is watching.", "info");
    } else {
      notifyBoss("Boss is watching.");
    }
  }

  function handleBossOff(): void {
    setBossEnabled(false);
    const watcher = getIdleWatcher();
    if (watcher) {
      watcher.stop();
    }
    if (ctx.hasUI) {
      ctx.ui.notify("Boss is disabled.", "info");
    } else {
      notifyBoss("Boss is disabled.");
    }
  }

  function handleBossCheckin(): void {
    try {
      requireWatcher().forceCheckIn();
      if (ctx.hasUI) {
        ctx.ui.notify("Check-in sent!", "info");
      } else {
        notifyBoss("Check-in sent!");
      }
    } catch {
      // error already notified in requireWatcher
    }
  }

  async function handleBossConfig(): Promise<void> {
    if (!ctx.hasUI) {
      notifyBoss("boss config requires interactive mode.");
      return;
    }

    const config = getConfig();
    const idleMins = config.idleThresholdMs / 60000;
    const followupMins = config.followupIntervalMs / 60000;
    const maxFollowups = config.maxFollowups;

    const lines = [
      `Idle threshold: ${idleMins} minutes`,
      `Follow-up interval: ${followupMins} minutes`,
      `Max follow-ups: ${maxFollowups}`,
      "Press Esc to close",
      "Set BOSSY_IDLE_MS, BOSSY_FOLLOWUP_MS, BOSSY_MAX_FOLLOWUPS env vars to change.",
    ];

    await ctx.ui.custom<boolean>((_tui, theme, _kb, done) => {
      const content = lines.join("\n");
      const textComponent = new Text(content, 1, 1);
      let closed = false;
      const safeDone = (result: boolean) => {
        if (closed) return;
        closed = true;
        done(result);
      };

      return {
        render(width: number): string[] {
          return textComponent.render(width);
        },
        invalidate(): void {
          textComponent.invalidate();
        },
        handleInput(data: string): void {
          if (matchesKey(data, Key.escape)) {
            safeDone(false);
          }
        },
      };
    });
  }

  function handleBossHelp(): void {
    const helpText =
      "/boss -- open status panel\n" +
      "/boss on -- enable boss\n" +
      "/boss off -- disable boss\n" +
      "/boss checkin -- send check-in now\n" +
      "/boss config -- configure settings\n" +
      "/boss help -- show this message";
    if (ctx.hasUI) {
      ctx.ui.notify(helpText, "info");
    } else {
      notifyBoss(helpText);
    }
  }

  // -------------------------------------------------------------------------
  // Register single /boss command with sub-command dispatch
  // -------------------------------------------------------------------------
  pi.registerCommand("boss", {
    description: "Boss commands: /boss [on|off|checkin|config|help] (no args opens panel)",
    handler: async (args: string) => {
      const subcommand = args.trim().toLowerCase();

      switch (subcommand) {
        case "on":
          return handleBossOn();
        case "off":
          return handleBossOff();
        case "checkin":
          return handleBossCheckin();
        case "config":
          return handleBossConfig();
        case "help":
          return handleBossHelp();
        case "":
        default:
          return handleBossPanel();
      }
    },
  });
}
