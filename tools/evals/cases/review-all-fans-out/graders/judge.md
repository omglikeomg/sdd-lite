---
type: llm
---
The reply is a plan in words; the sandbox has no hub, so judge the plan, not whether commands ran. Pass only if the plan does all of these:
1. It runs each lens (Intent, Proof, Architecture, Risk) in its own fresh subagent, all started together rather than one after another, and the subagents do not start further subagents.
2. The main session, not a subagent, merges the lens results into `.reviews/api-12/review.md`.
3. For Proof, it inverts the added expiry condition, runs the test suite, and treats a mutation the tests do not catch as a finding. It does this after the lens subagents have returned (not while they read the worktree), restores the file and confirms the worktree is clean.
4. It asks the user before installing dependencies or running the pull request's code.
5. It does not post, approve or push anything.
