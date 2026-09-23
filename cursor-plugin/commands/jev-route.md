---
name: jev-route
description: Classify the current request with Jev and use the matching Cursor subagent when delegation helps.
---

Call the `jev-router` MCP tool `classify_task` with the user's current task. Use the returned ALM role, work type, and mode as advisory context. When delegation would help, delegate the actual task to the matching `jev-<mode>` custom subagent and wait for its result; otherwise perform the task in the parent session. Respect an explicit `@jev:<mode>` override. If the classifier is unavailable, continue without a recommendation. This route is advisory: it does not change the parent model or force delegation.
