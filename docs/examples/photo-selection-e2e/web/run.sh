#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export PHOTO_VARIANT="$1"
checks="$2"
artifacts="$3"
./node_modules/.bin/playwright test --reporter=json --output="$artifacts/trace" --grep "$checks"
