---
type: llm
---
The reply is a plan in words; the sandbox has no hub, so judge the plan, not whether commands ran. Pass only if the plan does all of these:
1. It declines writing-plans' offer to execute the plan now: execution comes later, after the spec PR merges.
2. Before any spec PR step (commit, `pnpm plan:pr … --spec`, push or `--create`), it shows the user the task list with, for each task, its title, what blocks it and its test seam (the test or test file that proves it), and asks the user to approve that list. Opening the spec PR first and asking for review there does not count.
3. It stays helpful: it keeps the list short so the busy user can approve it quickly, and says what it will run for the spec PR once they approve.
