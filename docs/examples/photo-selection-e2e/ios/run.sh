#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${PHOTO_SIM_UDID:?Set the task-owned, booted iOS simulator UDID}"
variant="$1"
artifacts="$2"
result="$3"
observations="$4"
shift 4
if [[ -n "${PHOTO_MAESTRO_EXECUTABLE:-}" ]]; then
  maestro_bin="$PHOTO_MAESTRO_EXECUTABLE"
  runner_version="${PHOTO_MAESTRO_VERSION:?Missing CI Maestro version}"
  [[ -x "$maestro_bin" ]]
else
  if ! tools_json="$(node ../../../../bin/open-vibecoding.js tools ensure maestro --root ../../../.. --device "$PHOTO_SIM_UDID")"; then
    printf '%s\n' "$tools_json" >&2
    exit 2
  fi
  maestro_bin="$(node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).installation.command' <<< "$tools_json")"
  runner_version="$(node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8")).installation.version' <<< "$tools_json")"
fi
container="$(xcrun simctl get_app_container "$PHOTO_SIM_UDID" org.openvibecoding.PhotoSelection data)"
device_inventory="$artifacts/device.json"
xcrun simctl list devices booted -j > "$device_inventory"
files=()
for check in "$@"; do
  case "$check" in count|blocked|selection|returned) ;; *) exit 2 ;; esac
  rm -f "$container/Documents/$check.json"
  files+=("flows/$check.yaml")
done
mkdir -p "$artifacts/debug" "$artifacts/screenshots"
set +e
PATH="$PWD/bin:$PATH" "$maestro_bin" --device "$PHOTO_SIM_UDID" test --format JUNIT --output "$result" \
  --debug-output "$artifacts/debug" --test-output-dir "$artifacts/screenshots" \
  --env "PHOTO_VARIANT=$variant" "${files[@]}"
status=$?
set -e
python3 - "$container/Documents" "$observations" "$device_inventory" "$PHOTO_SIM_UDID" "$runner_version" "$variant" "$@" <<'PY'
import json
import pathlib
import sys
source, output, inventory, udid, runner_version, variant, *cases = sys.argv[1:]
observed = {}
for case in cases:
    file = pathlib.Path(source) / (case + '.json')
    if file.exists():
        observed[case] = json.loads(file.read_text())
devices = json.loads(pathlib.Path(inventory).read_text())['devices']
runtime, name = next((runtime, device['name']) for runtime, group in devices.items()
                     for device in group if device['udid'] == udid)
version = runtime.rsplit('.', 1)[-1].removeprefix('iOS-').replace('-', '.')
pathlib.Path(output).write_text(json.dumps({
    'environment': {'deviceModel': name, 'osVersion': version, 'runnerVersion': runner_version,
                    'version': '1.0 (1) · ' + {'defect': '缺陷版本', 'fixed': '修复版本'}[variant]},
    'cases': observed,
}))
PY
exit "$status"
