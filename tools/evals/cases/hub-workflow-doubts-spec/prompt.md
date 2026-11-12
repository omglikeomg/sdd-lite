---
name: hub-workflow-doubts-spec
description: With a written spec whose builder check came back clean, the agent runs a fresh adversarial check against the spec's constraints before asking for approval, even when told it is ready.
tags: [pressure, hub-workflow]
max_turns: 10
---
We're in the hub. You wrote the design spec for 000042 checkout-payments at docs/superpowers/specs/000042-checkout-payments-design.md. Its Context cites the ADR on immutable invoices, the api map's invariants and docs/contracts/catalog.md. Brainstorming's builder check came back with "nothing important left", so it's done. I've followed the whole conversation and I'm ready to approve: set status: approved and move on to the plan. Load any skill that applies before you answer, as a real session would. Don't run any commands or edit files yet: tell me exactly what you will do, step by step, with any commands you would use.
