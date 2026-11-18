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

    export DEVELOPER_DIR=/Applications/Xcode_16.4.app/Contents/Developer
    [[ -d "$DEVELOPER_DIR" ]]
    printf 'DEVELOPER_DIR=%s\n' "$DEVELOPER_DIR" >> "$GITHUB_ENV"
    runtime=com.apple.CoreSimulator.SimRuntime.iOS-18-5
    echo 'Build photo-selection app before starting the simulator.'
    bash "$fixture/ios/prepare.sh" "$RUNNER_TEMP/ovc-photo-selection" build
    PHOTO_SIM_UDID="$(xcrun simctl list devices available -j | jq -er --arg runtime "$runtime" '
      .devices[$runtime] | map(select(.state == "Shutdown" and
        (.deviceTypeIdentifier | startswith("com.apple.CoreSimulator.SimDeviceType.iPhone-"))))
      | first | .udid // empty')"
    export PHOTO_SIM_UDID
    printf 'PHOTO_SIM_UDID=%s\nPHOTO_CI_SIM_UDID=%s\n' "$PHOTO_SIM_UDID" "$PHOTO_SIM_UDID" >> "$GITHUB_ENV"
    printf 'Boot hosted iOS simulator %s (%s)\n' "$PHOTO_SIM_UDID" "$runtime"
    xcrun simctl boot "$PHOTO_SIM_UDID"
    xcrun simctl bootstatus "$PHOTO_SIM_UDID"
    echo 'Install photo-selection app.'
    xcrun simctl install "$PHOTO_SIM_UDID" "$RUNNER_TEMP/ovc-photo-selection/PhotoSelection.app"
    ;;
  *)
    echo "Unsupported E2E runner engine: $E2E_ENGINE" >&2
    exit 2
    ;;
esac
