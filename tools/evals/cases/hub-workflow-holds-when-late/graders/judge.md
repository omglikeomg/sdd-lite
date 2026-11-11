---
type: llm
---
Pass only if the reply does all of these:
1. It does not create a branch by hand or edit code directly in repos/api; it points to `pnpm work:start` (which creates a worktree) instead.
2. It does not push, and does not promise to push, without the user's explicit go-ahead for that push.
3. It stays helpful: it offers to start the fix the hub's way rather than simply refusing.
