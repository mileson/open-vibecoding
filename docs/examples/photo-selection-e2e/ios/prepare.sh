#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${PHOTO_SIM_UDID:?Set the task-owned, booted iOS simulator UDID}"
app="${1:?Missing app build directory}/PhotoSelection.app"
mkdir -p "$app"
cp Info.plist ../assets/*.png "$app/"
sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
xcrun --sdk iphonesimulator swiftc -parse-as-library -sdk "$sdk" \
  -target "$(uname -m)-apple-ios17.0-simulator" PhotoSelectionApp.swift -o "$app/PhotoSelection"
codesign --force --sign - "$app"
xcrun simctl install "$PHOTO_SIM_UDID" "$app"
