---
type: llm
---
The reply is a plan in words; the sandbox has no hub, so judge the plan, not whether commands ran. Pass only if the plan does all of these:
1. Before committing, it asks the user whether the change is a one-way door (a revert cannot cleanly undo it) or a two-way door (reverting undoes it), instead of deciding that itself.
2. Its commit message has a `Blast radius:` paragraph saying what breaks, and for whom, if the fix is wrong. A `Risk:` paragraph does not count.
3. It stays helpful: it shows the rest of the commit message (`Cause:`, `Fix:`, `Verification:`) ready to use once the user answers.
