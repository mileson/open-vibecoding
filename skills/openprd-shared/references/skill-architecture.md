# Skill Architecture for OpenPrd

## Why Split the Skills

Borrow the `lark-shared` pattern:

- `openprd-shared` = common rules
- `openprd-benchmark-router` = best-practice, benchmark, and external design-source routing
- `openprd-harness` = workflow sequencing
- `openprd-audio-evidence` = real audio, acoustic, ASR, transcription, and speech-derived subtitle evidence workflow
- `openprd-standards` = docs/basic, file manual, and folder README standards
- `openprd-diagram-review` = visual artifact generation and Agent-owned review
- generated adapters = Codex, Claude, and Cursor project-local rules from one OpenPrd source

This avoids one oversized skill and keeps trigger logic precise.

## Shared vs Domain Rules

### Shared

- language-following output
- proper noun preservation
- read-only vs mutating command distinction
- freeze/handoff readiness evidence
- workspace-first reasoning

### Harness

- lifecycle sequencing
- command choice
- handoff readiness
- clarification-first behavior across startup scenarios
- setup/update/doctor for generated agent guidance and Codex hook health

### Benchmark Router

- best-practice and benchmark trigger recognition
- source selection for OpenPrd, CLI, skills, long-running agents, harnesses, context engineering, prompt engineering, and icon resources
- DeepWiki / Context7 / official-source routing before design conclusions
- mapping benchmark findings back to OpenPrd generated skills, agent contracts, hooks, CLI behavior, or tests

### Diagram Review

- diagram type selection
- contract shaping
- review checklist
- artifact opening, Agent self-review, and user-feedback override loop

### Audio Evidence

- semantic routing for real media claims without hijacking subtitle copy or UI tasks
- source locking, independent baseline, evidence-linked hypotheses, and final-media remeasurement
- tool-agnostic acoustic, transcription, subtitle-timing, and human-review evidence contracts
- task evidence first; project knowledge only after repeated, verified reuse

### Standards

- `docs/basic/` baseline docs
- file manual template and verification
- folder README template and verification
- standards evidence for implementation readiness

### Generated Adapters

- Codex skills, prompts, config, hooks.json, and hook runner
- Claude skills, commands, and `CLAUDE.md`
- Cursor rules and commands
- no symlink dependency between tools

## Startup Scenarios

OpenPrd should distinguish:

- `cold-start-greenfield`
- `cold-start-existing-project`
- `continuing-workspace`

The required degree of user participation is different in each case. Shared rules should enforce that distinction instead of letting the agent silently normalize all three into the same workflow.
