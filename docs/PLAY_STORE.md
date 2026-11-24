# Publishing the Android app on Google Play

The Android app is a Trusted Web Activity wrapper (`android/`) around the live site. Nothing in this file has been run;
it is a checklist to follow by hand. Policy numbers below were checked on 24 Nov 2026 against Google's pages, but
Play rules change often: re-check the linked page before relying on a date.

## 1. Developer account

- Register at https://play.google.com/console/signup. One-off fee US$25. Identity verification (government ID, and a
  payment profile with your legal name and address) can take days.
- Personal account: your name and address may be shown publicly on the store listing. An organisation account (needs a
  D-U-N-S number) avoids that and avoids the closed-testing rule below, but needs a business entity.
- Closed-testing rule: personal accounts created after 13 Nov 2023 must run a closed test with at least 12 testers opted
  in continuously for 14 days, still enrolled on the day you apply for production access. If Google rejects the request,
  testing restarts. Source: https://support.google.com/googleplay/android-developer/answer/14151465
  Plan for about 3 weeks from first upload to production. Recruit 15 or more testers (friends, club members) since some drop out.

## 2. Target API level

New apps and updates must target Android 16 (API level 36) from 31 Aug 2026. Source:
https://support.google.com/googleplay/android-developer/answer/11926878 and
https://developer.android.com/google/play/requirements/target-sdk
UNVERIFIED: whether Bubblewrap 1.27.0 generates `targetSdkVersion 36`. After the first `./build.sh`, open
`android/app/build.gradle` (or `build.gradle`) and confirm `targetSdkVersion` is 36 or higher. If not, bump the pinned
Bubblewrap version in `android/build.sh` (check `npm view @bubblewrap/cli time --json`; use one at least a week old).
Play Console also flags this on upload.

## 3. Toolchain (macOS)

```sh
brew install openjdk@17
brew install --cask android-commandlinetools
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"   # if empty: export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
mkdir -p "$ANDROID_HOME"
sdkmanager --sdk_root="$ANDROID_HOME" "platform-tools" "platforms;android-36" "build-tools;36.0.0"
yes | sdkmanager --sdk_root="$ANDROID_HOME" --licenses
export PATH="$PATH:$ANDROID_HOME/platform-tools"
```

Put the two exports in `~/.zshrc`. Homebrew may need `sudo ln -sfn $(brew --prefix openjdk@17)/libexec/openjdk.jdk /Library/Java/JavaVirtualMachines/openjdk-17.jdk`
for `java_home` to find it.

## 4. Build and sign

1. Create the upload keystore (command in `android/README.md`). Back it up now (see section 14).
2. `export BUBBLEWRAP_KEYSTORE_PASSWORD=... BUBBLEWRAP_KEY_PASSWORD=...` then `cd android && ./build.sh`.
3. Result: `android/app-release-bundle.aab` (for Play) and `app-release-signed.apk` (for adb).
4. Use Play App Signing (default and required for new apps): you sign with the upload key, Google re-signs with the app signing key.

## 5. Digital Asset Links (removes the browser address bar)

Without this the app opens with a visible browser bar.

1. Upload key fingerprint:
   `keytool -list -v -keystore android/keystore/upload.jks -alias upload | grep SHA256`
2. After the first upload, Play Console > your app > Test and release > App integrity > App signing shows the
   "App signing key certificate" SHA-256. This is the one real users get.
3. In Replit Secrets set `ANDROID_PACKAGE_NAME=com.abhayjhade.pokerclubs` and
   `ANDROID_CERT_SHA256=<play signing SHA-256>,<upload SHA-256>` (comma separated, `AA:BB:..` format; include both).
4. Republish the site, then check:
   `curl -s https://pokerclubs.abhayjhade.com/.well-known/assetlinks.json`
   and Google's API:
   `curl -s "https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://pokerclubs.abhayjhade.com&relation=delegate_permission/common.handle_all_urls"`
   Both fingerprints and the package name should appear.
5. Testing the Play-installed app is what proves the Play signing key; a locally sideloaded APK uses the upload key.

## 6. Create the app in Play Console

- Create app: name "Poker Clubs", default language English, App (not game), Free.
- Declarations: confirm policy and US export law.
- Release track order: Internal testing (up to 100 testers, available in minutes, use to verify the asset links and
  login) then Closed testing (the 12 testers for 14 days) then Production (after Google approves the request).
  Review of the production request takes about a week.

## 7. App access (login required)

Joining is invite-only, so reviewers cannot sign up. In App content > App access choose "All or some functionality is
restricted" and supply:

- A reviewer account (email and password) created for this purpose, not a real member.
- A seeded demo club with a few made-up players and recorded nights, and that reviewer as a member (or owner).
- Short instructions: "Sign in with the email and password above. Home shows standings; Games lists recorded nights."
- Keep the account and club alive for as long as the app is listed. Do not use real member names.
- Fallback if needed: the public demo at `/demo` (see `docs/DEMO.md`) can be mentioned in the notes.

## 8. App content declarations

- Ads: No ads.
- Target audience: 18 and over only. Not appealing to children.
- Content rating (IARC questionnaire, category "Utility / reference" or similar):
  the app records results of poker nights that people play with friends. It does not host games, deal cards, take bets or
  handle real money; no payments, no gambling. Answer "No" to simulated gambling and real-money gambling questions.
  Mention "references to gambling" honestly if the questionnaire offers an option for it. Expect a mature-ish rating;
  that is fine.
- Gambling policy: Play restricts real-money gambling apps. State plainly in the listing and the review notes that the app
  is a results tracker only and does not process bets, deposits or payouts. Avoid words such as "betting", "wager" and
  "casino" in the listing and screenshots. Settle-up screens show who owes whom as bookkeeping only; do not describe
  them as payments.
- News, health, financial features, government: all No. (Settle-up is a calculator, not a financial service; answer
  "financial features" honestly if the form wording covers expense tracking.)
- Data safety: section 9. Privacy policy: section 10.

## 9. Data safety answers

Derived from `artifacts/poker-dashboard/src/views/legal.tsx` and `lib/db/src/schema`. Re-check if the app collects more.

Overall:
- Collects or shares user data: Yes.
- Encrypted in transit: Yes (HTTPS only).
- Users can request deletion: Yes (in-app Account page and web page, section 10).

| Data type | Collected | Shared | Purpose | Optional |
|---|---|---|---|---|
| Name | Yes | No (see note) | App functionality, account management | No |
| Email address | Yes | No (see note) | Account management, app functionality (invites, password reset) | No |
| User IDs (account id) | Yes | No | App functionality, account management | No |
| Photos (optional profile picture) | Yes | No | App functionality | Yes |
| Other user-generated content (player name, buy-ins, cash-outs, results, tournaments) | Yes | No | App functionality | No |
| App interactions (sections opened, time on site, sign-in times) | Yes | No | Analytics | No |
| Device or other IDs / IP address (sign-in records: device type, IP) | Yes | No | Security, fraud prevention | No |

Not collected: location, contacts, financial info or payment info (results are numbers the club types in, not payment data),
health, messages, audio, files, calendar, web browsing history, advertising ID.

Sharing note: Google's definition of "sharing" excludes transfers to service providers who process data on your behalf
(Resend for email, Replit for hosting, Google sign-in handled by Google). Under that rule answer "No" for sharing. Screenshots
an admin uploads are sent to Anthropic to read text and not kept; treat as a service provider too, and mention it in the
privacy policy (it already does). If you prefer to be conservative, you may declare "Photos" as shared with a service provider
for app functionality; that is also acceptable.

Security practices: data encrypted in transit; users can request deletion; no independent security review claimed.

## 10. URLs

- Privacy policy: https://pokerclubs.abhayjhade.com/privacy
- Account deletion (Data safety > Delete account URL): https://pokerclubs.abhayjhade.com/delete-account
  The route `/delete-account` exists in the site (`AccountDeletionPage`); confirm it loads when signed out and explains
  what is deleted and what is kept (club results stay under the player name, unlinked). Play requires a public
  web page for this, reachable without signing in. Also keep the in-app deletion route.
- Contact email for the listing: the address in `VITE_CONTACT_EMAIL`.
- Website: https://pokerclubs.abhayjhade.com

## 11. Store listing text (draft)

App name: Poker Clubs

Short description (max 80 characters, this is 66):
```text
Track results, standings and game history for your home poker club.
```

Full description (max 4000 characters):
```text
Poker Clubs keeps score for your home poker group, so nobody has to maintain a spreadsheet.

Poker Clubs is a results tracker. It does not host games, deal cards, take bets or handle real money. It is a notebook for games you play in person with friends.

What you get
- Standings: a leaderboard for the month, the year and all time, with a points system your club can set up.
- Game history: every night you recorded, with who played, buy-ins, cash-outs and the result.
- Record a night: type the results in, paste them, or import a CSV or spreadsheet. Fix mistakes later.
- Tournaments: track events and finishing positions.
- Settle-up helper: see who owes whom after a night, as simple bookkeeping.
- Share cards and monthly recaps: nice images of the results to post in your group chat.
- Years: look back at previous seasons.

Built for private clubs
- Invite-only. A club owner invites members by email or link, so only your group sees your results.
- Clubs are separate from each other. Other clubs see nothing of yours.
- Owners and admins manage members, points rules and club settings.

Your data
- No ads and no tracking cookies. We do not sell your data.
- You can delete your account from the Account page, or on the web at pokerclubs.abhayjhade.com/delete-account.
- Privacy policy: pokerclubs.abhayjhade.com/privacy

You need an invitation from a club to join, or you can start your own club. Must be 18 or over.
```

Category: Tools or Productivity (avoid Casino / Card, which invites the gambling review).
Tags: do not add casino or gambling tags.

## 12. Graphic assets

- App icon: 512 x 512 PNG, up to 1 MB. Use `artifacts/poker-dashboard/public/icons/icon-512.png`. Play applies its own mask; do not pre-round it.
- Feature graphic: 1024 x 500 PNG or JPEG, no alpha. Needs to be made (not in the repo).
- Phone screenshots: 2 to 8, PNG or JPEG, each side between 320 and 3840 px, long side no more than twice the short side;
  16:9 or 9:16 recommended. Existing `public/screenshots/home-narrow.png` (540x960) is a start; capture more from the
  demo club (Home, Games, a game, Standings, Recap). Use made-up player names only; no real member names or faces.
- Optional: 7 and 10 inch tablet screenshots (needed to be eligible for tablet featuring).

## 13. Device testing with adb

Phone side: Settings > About phone > tap Build number 7 times > Developer options > enable USB debugging
(or Wireless debugging on Android 11+).

USB:
```sh
adb devices                       # accept the prompt on the phone
adb install -r android/app-release-signed.apk
adb shell am start -a android.intent.action.VIEW -d https://pokerclubs.abhayjhade.com/dashboard
adb logcat | grep -i -E "chromium|twa|pokerclubs"
```

Wireless (phone and Mac on the same Wi-Fi):
```sh
adb pair <ip>:<pairing-port>      # code shown under Wireless debugging > Pair device with pairing code
adb connect <ip>:<port>           # port shown on the main Wireless debugging screen
```

Notes: a sideloaded APK is signed with the upload key, so the asset links must include the upload SHA-256 for the
address bar to disappear. If the bar still shows, Chrome caches asset links; clear Chrome's data for the site or wait,
then confirm with the Google API check in section 5. Chrome must be installed and up to date on the device.

## 14. Keystore backup warning

`android/keystore/upload.jks` and its passwords are git-ignored on purpose. Copy them to at least two places off this Mac
(password manager attachment, encrypted drive). If lost, you can ask Google to reset the upload key (Play Console >
App integrity > Request upload key reset), which takes days. Never commit the keystore or passwords, and never paste them
into chat.

## Pre-submission checklist

- [ ] Developer account verified
- [ ] Toolchain installed, `./build.sh` produces the `.aab`, targetSdk 36 or higher confirmed
- [ ] Internal test installed from Play, no address bar, login works
- [ ] assetlinks.json shows package name and both fingerprints; Google API check passes
- [ ] Reviewer account and seeded demo club ready; app access filled
- [ ] Data safety, content rating, target audience (18+), ads (none) completed
- [ ] Privacy and deletion URLs load without signing in
- [ ] Listing text, icon, feature graphic, 2+ phone screenshots uploaded
- [ ] Closed test: 12+ testers opted in for 14 days, then apply for production
- [ ] Keystore backed up
