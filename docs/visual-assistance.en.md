# Visual localization and image annotation

[简体中文](./visual-assistance.md) · [Home](../README_EN.md)

When a user asks an agent to align a button with a field or highlight an issue in a screenshot, the target and coordinate system must be clear. Grids help observation, explicit mappings connect a preview to its original, and deterministic annotation draws the result. Visual inspection is still required.

## When to use it

| Goal | Method and boundary |
| --- | --- |
| Position a component from a reference | Inspect the real screenshot; use a red grid and close-ups when precision matters. Actual UI actions follow the browser or Computer Use tool's coordinate contract |
| Map a rectangle from a scaled or cropped preview | Declare the displayed image-content dimensions and its crop in the original. Do not guess an unknown scale |
| Explain an issue or where to click | Frame the complete control, write an action or result label, and protect background text and neighboring controls |
| Understand an image's meaning | Read the image directly; do not create grids, annotation assets, or reports without a reason |

The method draws on screenshot-annotator's coordinate grids, complete-target boundaries, label avoidance, and visual review. This toolkit keeps lightweight tools and separate capabilities without distributing personal preferences, private material, or a full tutorial-production workflow.

## Two independent internal capabilities

- [Visual localization](../skills/open-vibecoding-visual-localization/SKILL.md) provides pixel grids, close-up inspection, and coordinate-basis guidance.
- [Image annotation](../skills/open-vibecoding-image-annotation/SKILL.md) provides target frames, short labels, and geometry checks; it can reuse localization.

Routing, visual implementation, acceptance verification, and tool selection include scenario guidance. Codex installs these as internal skills rather than extra menu entries; Claude and Cursor use their adapters. The agent selects methods from intent and evidence, without keyword routing or a mandatory new workflow.

## Reproduce the example

Run these commands from the current repository root after installing its dependencies. They use the source CLI rather than assuming a particular npm release. Choose new output filenames in an existing directory; repeated runs must use different names.

```sh
node bin/open-vibecoding.js visual-grid \
  --source docs/assets/open-vibecoding-visual-source.png \
  --out ./visual-grid-example.png --step 100

node bin/open-vibecoding.js image-annotate \
  --source docs/assets/open-vibecoding-visual-source.png \
  --out ./visual-annotation-example.png \
  --json-file docs/examples/visual-assistance/annotation-plan.json
```

The input is a [synthetic fixture](./assets/open-vibecoding-visual-source.png), not real account or business data. Its Chinese text describes downloading a report. The [plan](./examples/visual-assistance/annotation-plan.json) binds the original dimensions and SHA-256 and declares protected text and a neighboring control. Both outputs derive from that same original; annotation does not use the grid as its background.

![Actual red-grid tool output](./assets/open-vibecoding-visual-grid.png)

![Actual grid-free annotation output](./assets/open-vibecoding-visual-annotated.png)

`visual-grid` returns source dimensions, a hash, and optional `mappedTargets`; see the [coordinate contract](../skills/open-vibecoding-visual-localization/references/coordinates.md). `image-annotate` returns resolved frame and label positions; see the [plan contract](../skills/open-vibecoding-image-annotation/references/annotation-plan.md). These are agent-facing interfaces; users do not need to enter coordinates themselves.

## Verification and limits

Originals and existing outputs are never overwritten. Independent points omit numbering, ordered actions use numbers, and alternatives use letters. Labels avoid protected regions and other targets. Unsafe layouts require a shorter label, a different position, or separate images; changing the source invalidates the plan.

The tools check declared geometry, not OCR completeness or target recognition. `awaiting_visual_review` requires opening the full image, relevant details, and the final display size. It does not mean visual approval or independent human sign-off. Image pixels are not directly screen-click or CSS coordinates; scrolling, zooming, and window changes require rechecking the mapping.

Inputs are single-frame PNG, JPEG, or WebP, limited to 16M pixels and 64 MiB; output is a new PNG. Simple coordinate conversion supports declared proportional scaling and cropping. Rotation, perspective, composites, and letterboxing require an explicit transform first. The lightweight renderer uses adjacent labels; complex arrows, batch tutorials, and long reading boards can use optional specialized tools.

Originals, grids, and crops share the same privacy boundary and are not automatically uploaded. Before sharing, confirm authorization and redact sensitive material; derive later versions from the same verified safe source.

## Concept illustration

The homepage concept image was generated with Codex's built-in image generation. It explains localization, annotation, and verification, separately from the actual CLI examples above, and is not accuracy evidence. The [generation prompt](./assets/open-vibecoding-visual-assistance-concept.prompt.txt) is included. No personal accounts or private project screenshots are used in the published images.
