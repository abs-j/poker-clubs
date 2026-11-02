// Works out how this device can install the site, so the right instructions are shown when
// the browser does not offer its own install prompt (iPhone Safari never does).

export type InstallPlatform = "installed" | "inapp" | "ios" | "android" | "desktop";

export type InstallEnvironment = {
  userAgent: string;
  /** Running as an installed app (display-mode: standalone, or iOS navigator.standalone). */
  standalone: boolean;
  maxTouchPoints: number;
};

export function detectInstallPlatform({ userAgent, standalone, maxTouchPoints }: InstallEnvironment): InstallPlatform {
  if (standalone) return "installed";
  // Social apps open links in their own browser, which cannot add to the home screen.
  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|Snapchat|MicroMessenger|TikTok|Messenger/i.test(userAgent)) return "inapp";
  const iPadOnDesktopUa = /Macintosh/.test(userAgent) && maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(userAgent) || iPadOnDesktopUa) return "ios";
  if (/Android/.test(userAgent)) return "android";
  return "desktop";
}

export type InstallSteps = { title: string; steps: string[] };

export function installSteps(platform: InstallPlatform): InstallSteps {
  switch (platform) {
    case "ios":
      return {
        title: "Add to your Home Screen",
        steps: [
          "Tap the Share button at the bottom of Safari (the square with an arrow).",
          "Scroll down and tap “Add to Home Screen”.",
          "Tap “Add”. The Poker icon appears with your other apps.",
        ],
      };
    case "android":
      return {
        title: "Install on your phone",
        steps: [
          "Tap the menu (three dots) in your browser.",
          "Tap “Install app” or “Add to Home screen”.",
          "Confirm. The Poker icon appears with your other apps.",
        ],
      };
    case "inapp":
      return {
        title: "Open in your browser first",
        steps: [
          "This page is open inside another app, which can't install it.",
          "Tap the menu and choose “Open in Safari” or “Open in Chrome”.",
          "Then add it to your Home Screen from there.",
        ],
      };
    case "installed":
      return { title: "Already installed", steps: ["You're using the installed app."] };
    default:
      return {
        title: "Install on your computer",
        steps: [
          "Look for the install icon at the right of the address bar, or open the browser menu.",
          "Choose “Install” on the app’s own name (Chrome or Edge).",
          "It opens in its own window like any other app.",
        ],
      };
  }
}

const PROMPT_MIN_VISITS = 2;
const PROMPT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

/** The Home install prompt waits for a returning visitor and stays hidden for a month after a dismissal. */
export function shouldPromptInstall({ visits, dismissedAt, now }: { visits: number; dismissedAt: number | null; now: number }): boolean {
  if (visits < PROMPT_MIN_VISITS) return false;
  return !(dismissedAt && dismissedAt > 0 && now - dismissedAt < PROMPT_SNOOZE_MS);
}
