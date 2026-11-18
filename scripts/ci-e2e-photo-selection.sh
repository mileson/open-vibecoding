#!/usr/bin/env bash
set -euo pipefail
fixture=docs/examples/photo-selection-e2e

if [[ "${1:-}" == cleanup ]]; then
  if [[ -n "${PHOTO_CI_SIM_UDID:-}" ]] &&
    xcrun simctl list devices booted -j | jq -e --arg id "$PHOTO_CI_SIM_UDID" \
      'any(.devices[][]; .udid == $id and .state == "Booted")' >/dev/null; then
    xcrun simctl shutdown "$PHOTO_CI_SIM_UDID"
  fi
  exit
fi

case "${E2E_ENGINE:?Set the E2E runner engine}" in
  playwright)
    npm ci --prefix "$fixture/web"
    # GitHub's Ubuntu image already has Chrome and its system dependencies.
    if [[ -n "${GITHUB_ENV:-}" ]] && chrome="$(command -v google-chrome)"; then
      "$chrome" --version
      printf 'PHOTO_CHROMIUM_EXECUTABLE=%s\n' "$chrome" >> "$GITHUB_ENV"
    else
      npm exec --prefix "$fixture/web" -- playwright install --with-deps --only-shell chromium
    fi
    ;;
  maestro)
    : "${RUNNER_TEMP:?GitHub runner scratch directory required}" "${GITHUB_ENV:?Expected GitHub environment file}"
    node bin/open-vibecoding.js tools ensure maestro
    if xcrun simctl list devices booted -j | jq -e '[.devices[][] | select(.state == "Booted")] | length > 0' >/dev/null; then
      echo 'Another simulator is already booted.'
      exit 2
    fi

    runtime="$(xcrun simctl list runtimes -j | jq -er '
      [.runtimes[] | select(.isAvailable and (.identifier | contains(".iOS-")))]
      | sort_by(.version | split(".") | map(tonumber)) | last | .identifier // empty')"
    device_type="$(xcrun simctl list devices available -j | jq -er --arg runtime "$runtime" '
      .devices[$runtime] | map(select(.deviceTypeIdentifier | startswith("com.apple.CoreSimulator.SimDeviceType.iPhone-")))
      | first | .deviceTypeIdentifier // empty')"
    PHOTO_SIM_UDID="$(xcrun simctl create "Open VibeCoding E2E · ${device_type##*.}" "$device_type" "$runtime")"
    export PHOTO_SIM_UDID
    printf 'PHOTO_SIM_UDID=%s\nPHOTO_CI_SIM_UDID=%s\n' "$PHOTO_SIM_UDID" "$PHOTO_SIM_UDID" >> "$GITHUB_ENV"
    xcrun simctl bootstatus "$PHOTO_SIM_UDID" -b
    bash "$fixture/ios/prepare.sh" "$RUNNER_TEMP/ovc-photo-selection"
    ;;
  *)
    echo "Unsupported E2E runner engine: $E2E_ENGINE" >&2
    exit 2
    ;;
esac
