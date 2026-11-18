#!/usr/bin/env bash
set -euo pipefail
event="${1:?Expected a GitHub event name}"
base="${2:-}"
head="${3:-}"
web=false
ios=false

case "$event" in
  full|merge_group|schedule|workflow_dispatch)
    web=true
    ios=true
    ;;
  pull_request)
    : "${base:?Missing event base SHA}" "${head:?Missing tested SHA}"
    changes="$(mktemp -t ovc-e2e-changes.XXXXXX)"
    trap 'rm "$changes"' EXIT
    git diff --name-only --no-renames -z "$base" "$head" -- > "$changes"
    while IFS= read -r -d '' file; do
      case "$file" in
        docs/examples/photo-selection-e2e/web/*) web=true ;;
        docs/examples/photo-selection-e2e/ios/*) ios=true ;;
        docs/examples/photo-selection-e2e/*|src/*|bin/*|package.json|package-lock.json|\
        scripts/ci-e2e-*|.github/workflows/e2e*.yml|skills/open-vibecoding-test-strategy/*)
          web=true
          ios=true
          ;;
      esac
    done < "$changes"
    ;;
  *)
    printf 'Unsupported E2E event: %s\n' "$event" >&2
    exit 2
    ;;
esac

printf 'web=%s\nios=%s\n' "$web" "$ios"
