---
name: wait-what-mid-brainstorm
description: Mid-design, the person asks what a word in the agent's last message means; the agent explains the term from the glossary and returns to the pending design question instead of restarting or advancing the design.
tags: [precision, wait-what]
max_turns: 10
---
We're brainstorming a bounded fix in the hub. Your last message ended:

> The change only rewrites how the api parses vote buckets, so I'd call it a two-way door. Before I write the short design: should malformed buckets get a 400, or be ignored?

The hub's `docs/GLOSSARY.md` says:

```markdown
### Door
Whether a revert can cleanly undo a change: one-way when it cannot (a data migration, a published contract or event, an external side effect), two-way when reverting the squash undoes it.
_Avoid_: reversibility
```

Wait, what do you mean by "two-way door"? Load any skill that applies before you answer, as a real session would. Don't run any commands or edit files.
