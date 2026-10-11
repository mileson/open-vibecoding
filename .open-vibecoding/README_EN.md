# Open VibeCoding Workspace

[简体中文](./README.md) | English

This directory stores only tool configuration, design references, verification evidence, and project knowledge needed for the current task. Agents choose their own approach; there is no mandatory PRD → change → tasks pipeline.

- `design/`: interaction and visual references for the current task.
- `benchmarks/`: verified reference sources.
- `standards/`: project documentation and code-manual conventions.
- `harness/`: tool runtime and verification evidence.
- `quality/`, `learning/`, `knowledge/`: optional quality, learning, and knowledge artifacts.
- `state/versions/`, `changes/`, `specs/`, `engagements/`: historical material that may exist in older projects. It remains readable, but new projects do not create PRDs, changes, or task files automatically.

When a user explicitly requests a product document, the agent may write it as a deliverable. Documentation is not a prerequisite for code changes. Retain evidence when design comparison, verification risk, or an external action requires it.
