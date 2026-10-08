@AGENTS.md

## Claude Code specifics

- Install Superpowers with `/plugin install superpowers@claude-plugins-official`. Its session-start hook loads the skills; this file only adds the hub's rules on top.
- Do not use the built-in worktree tool for product work: it would create a worktree of the hub. `pnpm plan:start` creates the right worktree inside the product repository, and Superpowers detects it as already isolated.
- A session started inside `.worktrees/…` still loads this file because Claude Code reads `CLAUDE.md` from parent directories.
