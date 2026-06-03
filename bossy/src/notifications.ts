import { ExtensionContext } from "@earendil-works/pi-coding-agent";

export function notifyBoss(message: string): void {
  try {
    if (process.env.WT_SESSION) {
      // Windows Terminal
      const escapedMessage = message.replace(/"/g, '\\"');
      const ps = `
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = @"
        <toast><visual><binding template="ToastText02"><text id="1">Boss</text><text id="2">${escapedMessage}</text></binding></visual></toast>
"@
        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xml.LoadXml($template)
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Boss").Show($toast)
      `;
      require("child_process").spawn("powershell.exe", ["-NoProfile", "-Command", ps], {
        stdio: "ignore",
        detached: true,
      }).unref();
    } else if (process.env.KITTY_WINDOW_ID) {
      // Kitty terminal - OSC 99
      process.stdout.write("\x1b]99;i=1:d=0;Boss\x1b\\");
      process.stdout.write(`\x1b]99;i=1:p=body;${message}\x1b\\`);
    } else {
      // Generic terminal - OSC 777
      process.stdout.write(`\x1b]777;notify;Boss;${message}\x07`);
    }
  } catch {
    // Silent fallback - notification is non-critical
  }
}

export function isBossInitiatedTurn(ctx: ExtensionContext): boolean {
  const branch = ctx.branch;
  if (!branch || branch.length === 0) return false;

  const last = branch[branch.length - 1];
  return (
    last.message?.role === "user" &&
    (last as any).customType === "bossy-boss"
  );
}