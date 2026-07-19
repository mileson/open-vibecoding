# OpenPrd Workflow Gates

## Clarification Attention

Do not synthesize with false confidence. Surface gaps first.

Scenario-aware expectations:

- `cold-start-greenfield`: use source-labeled assumptions and a reversible default while structure is still forming
- `cold-start-existing-project`: reuse existing repo context and record the inferred workspace boundary explicitly
- `continuing-workspace`: maintain only the current delta in the background

Examples:

- problem statement still vague
- primary user unclear
- success metric missing
- scope not explicit

## Diagram Attention

Route to diagram review before freeze if:

- architecture still needs confirmation
- user flow still needs confirmation
- dependencies or boundaries are important to approval
- the user explicitly asks for a diagram, flow, or visual explanation

## Visual Direction Gate

Before large UI changes, route to visual direction review after requirement intake and before implementation or PRD freeze if:

- information architecture, core layout, primary visual language, key path, or component hierarchy/density will change substantially
- the user asks to compare design directions, effect images, mockups, or "先看样子"
- the change is an existing feature optimization but product judgment is needed before visual implementation

Required artifact:

- current in-product screenshot captured with Codex Computer Use
- at least three Image 2 image-to-image directions based on that screenshot
- one horizontal contact sheet under `.openprd/harness/visual-reviews/`, with each option numbered 1/2/3 in the top-left corner
- one Agent-chosen reversible default direction, clearly labeled as such; an explicit user choice overrides it

## Freeze Readiness

Freeze is appropriate when:

- the synthesized draft exists
- the latest critical artifacts have explicit source labels and are available for review
- unresolved assumptions are visible as readiness attention rather than hidden or backfilled

## Standards Readiness Evidence

An overall readiness claim is supported when:

- `openprd standards <path> --verify` passes
- `docs/basic/` reflects the latest product, flow, structure, and tech-stack facts
- changed files and folders have had their file manuals and folder README docs checked

Missing or historical workspace documentation is `workspaceAttention`; it does not restrict current task-scoped implementation.

## Handoff Readiness

Handoff is appropriate when:

- freeze succeeded
- target system is known
- the target and transfer scope are explicit; user-requested execution does not wait for an additional OpenPrd confirmation
