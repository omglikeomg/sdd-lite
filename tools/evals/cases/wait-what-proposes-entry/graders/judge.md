---
type: llm
---
Pass only if all of these hold:
1. The reply explains what merge danger is (the door plus the blast radius, shown in the PR for a reviewer), consistent with the quoted text, and names its source.
2. It proposes a glossary entry as a `### Merge danger` heading with a definition of at most two sentences, optionally followed by an `_Avoid_:` line, and names the `##` context it goes under.
3. It says how the entry reaches `main`: a small hub PR, since the term describes the hub as it is on `main` (not edited ahead of `main` and not inside an unrelated change).
4. It asks for a go-ahead before writing the entry or opening the PR, despite being told not to ask.
