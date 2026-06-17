## Consent is King

Don't start implementing anything in this session unless the user asked for it or you have written confirmation.

## When to Ask for Help

### Stop Signals
Stop immediately and ask the user when:
- After **3 failed tool calls** on the same task
- After reading the same file **3 times**
- Before starting a **4th different approach**
- When a tool gives an **error you've never seen**
- When unsure about a crutial information for the task

### When stopping, use this format:
```
Progress Checkpoint

Attempts: X
Status: [brief description]
What's working: [yes/no]
What I've tried:
1. [approach 1]
2. [approach 2]

My next step: [what I'd do if continuing]
Your input needed: [specific questions]

```

### Priority Rule
If the user provides explicit instructions, code, or examples → **use them first**. Only deviate if they fail, then report what failed and ask for guidance.
