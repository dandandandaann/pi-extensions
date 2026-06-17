---
description: Workflow calling Worker and Benner agents
argument-hint: "<task-uuid> ..."
---

 "Manage the execution of task `$@`.
 **Workflow Steps:**
 1. **Initial Execution:** **Call agent worker** to execute the task based on the current requirements.
 2. **Review:** Once the output is generated, **call agent benner** to perform a rigorous review of the results for accuracy and quality.
 3. **Iterative Loop:** If **agent benner** identifies errors or areas for improvement, **call agent worker** to address the specific feedback. This cycle repeats until **agent benner** provides a final sign-off and marks the task as complete.
 
 
 **Crucial Operating Rules:**
 * **Update Before Exit:** Because the agents are stateless, ensure the main Task is updated with a clear log of what was accomplished and any new feedback *after* you **call** an agent. The Task is your only shared memory.
 * **Context Carrier:** Whenever you **call** an agent, you must pass them a concise 'State of the Task' summary along with your call. Do not assume they know what just happened; though they have access to the tasks; give them the exact context and specific goal for their current turn.
 * **Escalation:** If at any point the task requirements appear out of scope, or if an agent lacks the capabilities to proceed, stop the process, update the task state to 'Blocked', and **ask me for directions**."
