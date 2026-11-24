#!/usr/bin/env bash
# Builds the signed Android App Bundle (.aab) for Play. See android/README.md.
set -euo pipefail
cd "$(dirname "$0")"

BUBBLEWRAP_VERSION="1.27.0"

fail() { echo "error: $*" >&2; exit 1; }

[ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ] || fail "JAVA_HOME is not set to a JDK (e.g. export JAVA_HOME=\$(/usr/libexec/java_home -v 17))"
[ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME" ] || fail "ANDROID_HOME is not set to the Android SDK folder"
[ -n "${BUBBLEWRAP_KEYSTORE_PASSWORD:-}" ] || fail "BUBBLEWRAP_KEYSTORE_PASSWORD is not set"
[ -n "${BUBBLEWRAP_KEY_PASSWORD:-}" ] || fail "BUBBLEWRAP_KEY_PASSWORD is not set"
[ -f ./keystore/upload.jks ] || fail "keystore/upload.jks not found; see android/README.md"

BW=(npx --yes "@bubblewrap/cli@${BUBBLEWRAP_VERSION}")

"${BW[@]}" update --manifest=./twa-manifest.json --skipVersionUpgrade
"${BW[@]}" build --skipPwaValidation

echo "Done: $(pwd)/app-release-bundle.aab"
