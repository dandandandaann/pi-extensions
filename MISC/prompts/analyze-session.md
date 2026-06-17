---
description: Analyze a pi HTML session export for wrong turns
argument-hint: "<path-to-html-export>"
---
Analyze the pi session HTML export at `$1` for wrong turns and improvement recommendations.

${@:2}

## Session Data Location
The actual session data is base64-encoded inside the **first** `<script>` tag of the HTML file.
It decodes to a JSON object with `{ header, entries[], leafId, systemPrompt, tools }`.

## How to Extract
```javascript
const fs = require('fs');
const content = fs.readFileSync('$1', 'utf8');

// Find and decode the first script tag
const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
const script = scriptMatch[1];
const decoded = Buffer.from(script, 'base64').toString('utf8');
const session = JSON.parse(decoded);

// Each entry has:
// - type: "session" | "message" | "model_change" | "compaction"
// - message.role: "user" | "assistant" | "toolResult" | "toolUse"
// - message.content: array of content blocks (text, thinking, toolCall)

for (const entry of session.entries) {
  if (entry.type === 'message') {
    const role = entry.message.role;
    // user content: entry.message.content[0].text
    // assistant thinking: entry.message.content.find(c => c.type === 'thinking')?.thinking
    // tool calls: entry.message.content.filter(c => c.type === 'toolCall')
    // tool results: entry.message.content.filter(c => c.type === 'text')
  }
}
```

## What to Look For
1. **Tool validation errors** — Missing required parameters (e.g., `read` without `path`)
2. **Parameter confusion** — Using wrong param names (uuid vs name, content in create vs append)
3. **Wasted iterations** — Reading the same files multiple times
4. **Instructions not followed** — Skipping system prompt rules or deviation of user instructions
5. **Forgotten context** — Re-explaining things that should be in project docs
6. **Assuming information** — Assuming information about the project/task that was not provided instead of asking user

## Deliverables
1. **Wrong turns** — List specific mistakes with entry context (what happened, what went wrong)
2. **Root causes** — Why the agent went wrong (missing docs, unclear schemas, etc.)
3. **Recommendations** — Specific files/docs to add to the repo that would help
4. **Presentation** — HTML slide deck saved to the current directory

## Output Format
Create `html` file with slides that includes the session hash in the name `session-analysis-<#hash>.html`:
- Slide 1: Title and session overview
- Slides 2-5: Each wrong turn with context and timeline
- Slides 6+: Recommendations with specific file names and content suggestions