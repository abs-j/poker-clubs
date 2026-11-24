# Android app (Trusted Web Activity)

A thin Android wrapper around https://pokerclubs.abhayjhade.com, built with Bubblewrap (pinned in `build.sh`).
The full Play Store process is in `docs/PLAY_STORE.md`. Nothing here can be built without a JDK 17 and the Android SDK.

## Prerequisites

JDK 17, Android command-line tools, `JAVA_HOME` and `ANDROID_HOME` set (see `docs/PLAY_STORE.md`, "Toolchain").

## Create the upload keystore (once, never commit it)

Run this yourself. Choose a strong password and store it in a password manager.

```text
mkdir -p keystore
keytool -genkeypair -v -keystore keystore/upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Back up `keystore/upload.jks` and its passwords somewhere off this machine. The folder is git-ignored.

## Build

```sh
export BUBBLEWRAP_KEYSTORE_PASSWORD='...'
export BUBBLEWRAP_KEY_PASSWORD='...'
./build.sh
```

`build.sh` runs `bubblewrap update` (generates or refreshes the Android project from `twa-manifest.json`) and
`bubblewrap build`. Output, all git-ignored:

- `android/app-release-bundle.aab`: upload this to Play.
- `android/app-release-signed.apk`: for `adb install` testing.

## First-time init (only if `update` cannot generate the project)

The manifest is hand-written. If `update` complains about a missing project, run once, accept the values
already in the manifest, then keep using `build.sh`:

```sh
npx --yes @bubblewrap/cli@1.27.0 init --manifest=https://pokerclubs.abhayjhade.com/manifest.webmanifest
```

Note that `init` rewrites `twa-manifest.json`; re-check packageId, host, colours and signingKey with `git diff`.
Bubblewrap also asks to download a JDK and SDK; decline and point it at your own `JAVA_HOME` / `ANDROID_HOME`.

## Releasing a new version

1. Edit `twa-manifest.json`: increase `appVersionCode` by at least 1 (Play rejects repeats) and update `appVersion`.
2. `./build.sh`
3. Upload the new `.aab` to a Play track (internal first).

The web content updates by itself when you republish the site. A new Android build is only needed to change
the wrapper (icon, name, colours, target SDK, shortcuts) or when Play's target API requirement moves.
