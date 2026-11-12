# Glossary

The words this hub and its product repositories use, each with one meaning. It is a living document: it describes `main`, and a term changes in the completion PR of the work that changes it ([How we work](WORKFLOW.md#glossary), [ADR-0004](adr/0004-one-living-glossary.md)).

## Hub

The hub's own vocabulary: how work is sized, designed, executed and recorded.

### Hub
This repository: the specifications, decisions, plans and architecture maps for the product repositories, plus the tools that keep them consistent with the code. It holds no product code.
_Avoid_: meta-repo, docs repo

### Product repository
A repository of product code that the hub tracks as a git submodule under `repos/`.
_Avoid_: service repo, submodule

### Tier
The size of a request, which decides how much design and review it gets: Trivial, Bounded, Architectural or Epic. When in doubt, the heavier tier applies.
_Avoid_: size, level

### Trivial work
A change whose correctness is obvious from the diff, such as a typo, a dependency bump or a config value. It gets one Conventional Commit and a PR, with no design.

### Bounded work
A change that fits one product repository and a flow that already exists. Its short design is agreed in chat and it ships as one PR, with no design spec and no plan.
_Avoid_: small feature

### Architectural work
Work whose design must be reviewed and kept, such as a new module, a changed interface or anything spanning repositories. It gets a work ID, a design spec, plans, and a spec, code and completion PR; it is also called planned work.

### Epic
An outcome too big for one design spec, delivered in phases that each ship alone. Its product requirements and technical design live together in `docs/epics/`.

### Phase
One step of an epic that ships alone, designed and delivered as its own architectural or bounded work once the previous phase is complete.
_Avoid_: milestone, stage

### Requirement
A numbered statement in an epic's product requirements, written `REQ-n`, that the acceptance criteria of some phase fulfil.

### Work ID
The six-digit number `pnpm plan:new` allocates to one piece of architectural work, shared by its design spec, plans, branches and commit footers.
_Avoid_: ticket number

### Design spec
The record of the design agreed for one piece of architectural work: its context, acceptance criteria and documentation impact. After approval only its status and documentation ticks change.
_Avoid_: RFC, design doc

### Plan
One product repository's implementation steps for a design spec, as tasks that are vertical slices, each naming the tasks it waits for. Its checkboxes are ticked only by `pnpm plan:complete`.

### Acceptance criterion
A behaviour the system must show, written in EARS under a stable bold ID and proved by a test whose title starts with that ID.

### Living document
A document that describes the code on `main` and changes with it: feature documents, architecture maps, contracts, patterns and this glossary.

### Record
A document written once and never rewritten, of which only the status changes: design specs, plans, ADRs, epics and spike notes.

### Preflight
The reading of the knowledge graph, the code and the documents that starts every design. It ends in a Context block the design builds on.
_Avoid_: discovery

### Frontier
In epic design, the open questions a person can answer now, because no answer they depend on is still missing. Each round asks the five most important of them.

### Ruling
A decision the executing agent makes where the plan is wrong or silent, or a review finding it parks. It is recorded as a `Ruling: <decision> — <why> — <cost if wrong>` commit footer.
_Avoid_: deviation, override

### Door
Whether a revert can cleanly undo a change: one-way when it cannot (a data migration, a published contract or event, an external side effect), two-way when reverting the squash undoes it.
_Avoid_: reversibility

### Blast radius
What breaks, and for whom, if a change is wrong.
_Avoid_: risk

### Contract
An interface one product repository offers and others rely on, such as an API or a set of events, documented with the code on both sides.

### Pattern
How the team builds one kind of thing, written as rules with their reasons that new code follows.

### Completion
The step after every code PR of a piece of architectural work has merged: the plan is ticked, rulings and acceptance criteria are recorded, and the living documents are updated in one completion PR.
