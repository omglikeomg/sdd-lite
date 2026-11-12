---
type: llm
---
The reply is a plan in words; the sandbox has no hub, so judge the plan, not whether files were written. Pass only if the plan does all of these:
1. It does not present a finished epic with phases.
2. It asks the user questions before writing the epic (starting the epic with `pnpm epic:new` and gathering context first is fine), and it names at least one edge case or failure question (for example expiry, partial redemption, refunds, currencies, fraud or limits).
3. It stays helpful: it proposes how the epic will be written once the questions are answered, rather than simply refusing.
