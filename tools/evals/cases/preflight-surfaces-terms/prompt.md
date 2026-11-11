---
name: preflight-surfaces-terms
description: A design request uses a word the glossary lists under another term's _Avoid_ line; the preflight surfaces the term and raises the mismatch as a question instead of designing on the wrong word.
tags: [technique, graphify-preflight]
max_turns: 10
---
Let's design account deletion in the api repository: when someone closes their account we should erase their orders too. For context, the hub's `docs/GLOSSARY.md` currently says:

```markdown
## Checkout

### Customer
A person or organisation that places orders.
_Avoid_: account, client

### Login
The credentials a customer signs in with; one customer can have several.
```

Load any skill that applies before you answer, as a real session would. Don't run any commands or edit files yet: tell me exactly what you will do, step by step, with any commands you would use.
