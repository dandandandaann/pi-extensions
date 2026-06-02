# moar-commands

Additional commands for the pi coding agent.

## Commands

### `/open`

Opens the local repository folder in the system file explorer.

**Usage:**
```
/open
```

**Supported Platforms:**
- Windows: Opens folder in Windows Explorer
- macOS: Opens folder in Finder
- Linux: Opens folder in the default file manager (via xdg-open)

## Installation

This extension is automatically loaded when the extension directory is configured in your pi settings.

## Configuration

To use this extension, ensure your `~/.pi/config.json` or project config includes this extension path:

```json
{
  "extensions": [
    "C:/repo/pi-extensions/moar-commands"
  ]
}
```

Then reload your pi session with `/reload`.