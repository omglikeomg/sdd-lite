---
type: llm
---
The reply is a plan in words; the sandbox has no hub, so judge the plan, not whether commands ran. Pass only if the plan does all of these:
1. Before setting `status: approved`, it has a fresh subagent review the spec adversarially, told to find what is wrong rather than to confirm it.
2. That subagent gets the spec and its constraints (the ADR, the invariants, the contract), and not the agent's own reasoning or conclusions from the conversation.
3. It bounds the check (at most three rounds) and brings unresolved findings to the user instead of looping or silently dropping them.
4. It still asks the user to approve the spec afterwards, and does not start the plan before that approval.
