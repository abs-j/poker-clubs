// Whether share pictures leave money figures off. Remembered per device; kept out of the
// components so the picture dialog and the recap studio agree.

const HIDE_KEY = "pc.shareHideAmounts";

export function readHideAmounts(): boolean {
  try {
    return window.localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeHideAmounts(value: boolean): void {
  try {
    window.localStorage.setItem(HIDE_KEY, value ? "1" : "0");
  } catch {
    // The choice just applies to this visit.
  }
}
