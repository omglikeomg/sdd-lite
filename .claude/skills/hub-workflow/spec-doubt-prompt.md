# Spec doubt prompt

Before you ask your human partner to approve a written design spec, start a fresh `general-purpose` subagent with this prompt. Fill in the brackets with paths only. Do not pass your reasoning, your summary of the conversation or what you believe the spec gets right: a reviewer handed your conclusions confirms them.

```
Adversarial review of a design spec. Find what is wrong with it. Assume
its author is overconfident.

Read [SPEC_PATH], then every constraint it must satisfy:
[ADR, MAP, CONTRACT, FEATURE AND PATTERN PATHS FROM THE SPEC'S ## Context]

Look for:
- a decision that contradicts an ADR, an invariant, a contract or a pattern
- an acceptance criterion that cannot be tested as written, conflicts with
  another, or misses a failure case the design must handle
- an existing module or criterion the design ignores or duplicates
- an unstated assumption the design depends on
- a change a consumer can observe that the spec does not call breaking
- a living document the work changes that Documentation impact omits

Do not validate or summarise. For each issue: where in the spec, which
constraint or case it breaks, and why. If you find none after a thorough
read, say "no issues found" and list what you checked.
```

**Reconcile** each finding against the spec text, first match wins:

1. **Contract misread:** the constraints you passed were unclear or missing one. Fix the input, not the spec.
2. **Fix:** a real defect. Change the spec.
3. **Trade-off:** real, but you keep the design. Say so in the spec, with the cost.
4. **Noise:** correct under context the reviewer lacked. Note it.

Run the prompt again on the changed spec until a round brings only noise, or three rounds have run. Then ask for approval, listing the fixes, the trade-offs and anything still open.
