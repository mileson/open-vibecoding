# Language and Review Rules

## Language Following

User-facing artifact text should follow the user's current primary language.

Translate:

- titles
- subtitles
- section labels
- legend labels
- review instructions
- summary-card labels
- diagram contract visible fields, including component names, subtitles, details, flow labels, cards, panels, and review instructions

For `locale: zh-CN` diagram contracts, translate full sentences into Simplified Chinese and preserve only necessary product names, framework names, protocol names, command names, field keys, and file paths. Examples that may stay unchanged inside Chinese sentences: MotiClaw, Electron, TypeScript, CLI, API, JSON, NDJSON, dry-run, Host API, schema, `waiting_approval`.

Do not translate by default:

- product names
- project names
- service names
- framework names
- API names
- protocol names
- cloud product names

## Product Copy Localization

Product UI copy is rewritten for the target language, not translated word for word. Preserve the user action and outcome while adapting the phrase to the conventions and space of the destination surface.

| Surface | Default target-language treatment |
|---|---|
| Button, tab, menu item, short label | Use a concise, idiomatic product term or verb phrase. English example: `Auto Edit`, not `Start Automatic Editing`. |
| Dialog title, toast, status | State the result or next action directly; remove source-language filler that the interface already makes obvious. |
| Dialog body, help text, onboarding | Use a complete natural sentence when the user needs consequences, limits, or recovery guidance. |
| Tooltip or accessibility label | Restore the full meaning when the visible label is intentionally compact. |

- Use an abbreviation only when target users commonly understand it and the current product context makes it unambiguous.
- Do not invent shorthand, clip words mechanically, or expose internal jargon just to fit the control.
- Check every supported locale in the real control for semantic consistency, truncation, awkward wrapping, layout compression, and an accurate accessible name.
- A string-table update or character-count check alone does not prove that localized UI copy fits.

## Review Before Freeze

If the user still needs to confirm:

- system boundaries
- missing modules
- user-flow shape
- key dependencies
- review/sign-off behavior

prefer a visual review artifact before freeze.

## Open Questions Stay Visible

Do not hide:

- assumptions
- unresolved dependencies
- missing success criteria
- incomplete edge cases

These should remain visible in the artifact or review notes.
