import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export default function moarCommandsExtension(pi: ExtensionAPI): void {
    // Register /open command - opens the local repo folder
    pi.registerCommand("open", {
        description: "Open the local repository folder in the file explorer",
        async handler(_args, ctx) {
            const isWindows = process.platform === "win32";
            const isMac = process.platform === "darwin";

            // Use cwd from context, fallback to process.cwd()
            const folder = ctx.cwd || process.cwd();

            try {
                let cmd: string;
                if (isWindows) {
                    // Use start command - explorer returns exit code 1 even on success
                    cmd = `start "" "${folder}"`;
                    await execAsync(cmd);
                    ctx.ui.notify(`Opened folder: ${folder}`, "info");
                    return;
                } else if (isMac) {
                    cmd = `open "${folder}"`;
                } else {
                    // Linux
                    cmd = `xdg-open "${folder}"`;
                }

                await execAsync(cmd);
                ctx.ui.notify(`Opened folder: ${folder}`, "info");
            } catch (error) {
                // Linux fallback if xdg-open isn't installed
                if (!isWindows && !isMac && error instanceof Error && error.message.includes("ENOENT")) {
                    ctx.ui.notify("xdg-open not found. Try: sudo apt install xdg-utils (Linux)", "error");
                    return;
                }
                ctx.ui.notify(
                    `Failed to open folder: ${error instanceof Error ? error.message : String(error)}`,
                    "error"
                );
            }
        },
    });
}