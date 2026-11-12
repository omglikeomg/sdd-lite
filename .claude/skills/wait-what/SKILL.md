---
name: wait-what
description: Use when your human partner asks what a word, term or name means ("wait, what does X mean?"), says an explanation did not land, or is lost in the vocabulary of a design, spec, plan or epic, even mid-brainstorm - explains the term from the glossary, specs and code, and proposes a glossary entry when one is missing
---

# Wait, what?

## Overview

Your human partner stopped at a word. Answer that, and only that: what the word means in this system, where that meaning comes from, and how it applies to what you just said. Then give the conversation back exactly where it was.

**Announce at start:** "Using wait-what to explain the term."

A question about a word is not a request to rethink the design. Re-explaining is the job; changing your proposal, adding new questions or editing files is not.

## When NOT to use

- Gathering what exists before a new design: `graphify-preflight`.
- Deciding what a new concept should be in the product: that is design, `superpowers:brainstorming` (or `epic-design` for a PRD).
- Reviewing someone else's pull request: `review-pull-request`.

## Look it up, in this order

1. **`docs/GLOSSARY.md`**: the term's `###` entry and its `_Avoid_:` line. A word listed under another term's `_Avoid_:` means that other term.
2. **The records and maps**: design specs, epics, ADRs, feature documents, `docs/WORKFLOW.md`, the hub's skills, and the design in this conversation.
3. **The code**: run `graphify update .` first if you have not in this session, then `graphify query "<the word>"`, and open the files before citing them.

## The reply

One message, these parts in this order:

1. **Meaning.** One to three short sentences, one idea each, active voice, in the glossary's words.
2. **Here.** One or two sentences on how it applies to the message that prompted the question. Explain your earlier statement; do not revise it. If explaining it shows the statement was wrong, say so in one sentence and leave the fix for after the pending question.
3. **Source.** The link or `path::Symbol` each part came from, and whether that describes `main` or an unmerged design.
4. **Proposed entry**, only when the glossary lacks the term or its entry disagrees with how the hub uses the word:

   ```markdown
   ### Merge danger
   The section of a bounded PR that tells a reviewer what merging costs if the change is wrong: its door and its blast radius.
   ```

   One definition paragraph of at most two sentences, optionally an `_Avoid_:` line, no personal data. Name the `##` context it goes under, and where it goes:
   - the term describes code or process already on `main`: its own small hub PR on a `docs/glossary-<term>` branch from fresh `main`, never folded into unrelated work on the current branch;
   - the term belongs to an unmerged design: that design's Documentation impact, written in its completion PR.

   Then ask whether to go ahead. Write nothing until your partner says yes.
5. **Back to where you were.** If a question was pending, repeat it word for word as its own last line. Add no new question.

## Red flags

| Thought | Reality |
|---|---|
| "While I'm explaining, I'll refine the design" | They asked about a word. Explain, then repeat the pending question unchanged. |
| "The explanation raises a new question, I'll add it" | One pending question. Note the new point in a sentence; ask it after they answer. |
| "They said no need to ask, I'll add the entry" | The entry is a hub change with its own PR. Propose it and ask. |
| "I'll add the entry on this branch, it's open anyway" | A term already on `main` gets its own small PR; mixing it in hides it in unrelated review. |
| "I know what it means, no need to look" | The glossary's meaning is the hub's meaning. Look it up and cite it. |
| "The graph says so" without refreshing | Run `graphify update .` in this session before any claim about code. |

## Verification

Before you send the reply:

- [ ] The meaning comes from a source you read in this session — **Evidence:** the link or `path::Symbol` in the Source part.
- [ ] No design change, new question or file edit — **Evidence:** the reply's last line is the pending question as it was asked, or the end of the explanation when none was pending.
- [ ] A missing term has a proposed entry, with where it goes and a request for a go-ahead — **Evidence:** the entry block in the glossary's format and the question after it.
