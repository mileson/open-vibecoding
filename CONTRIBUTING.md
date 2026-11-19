# Contributing

Thanks for considering a contribution to Open VibeCoding.

## Development Setup

```bash
npm install
npm test
```

## Core Principles

- Keep Open VibeCoding lightweight and avoid premature workflow complexity.
- Prefer clarification, review gates, and durable artifacts over hidden assumptions.
- Keep agent-facing behavior in `skills/` and repository-level guidance in `AGENTS.md`.
- Avoid inventing commands or expanding the workflow unless a real usage pattern justifies it.

## Before Opening a PR

Please make sure:

- tests pass with `npm test`
- new CLI behavior is covered by tests
- README or skill references are updated when user-facing behavior changes
- Changes to the public README follow the [README and visuals guide](./docs/readme-guide.md)
- sensitive values are not committed

## Scope Guidance

Open VibeCoding adds product, design, engineering, and testing capabilities to coding agents. Prefer changes that help users complete a concrete task with less setup or clearer evidence.
