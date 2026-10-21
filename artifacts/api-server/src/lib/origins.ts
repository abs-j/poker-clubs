// Which web origins this app trusts. Used for sign-in CSRF checks and, importantly, before an
// origin is ever placed in a link we email, so our sender can't be used to push people to
// another site. Read from the environment on each call so it can be tested.

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function extraTrustedOrigins(): string[] {
  return (process.env.TRUSTED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
}

export function isLoopbackOrigin(origin: string): boolean {
  return LOOPBACK_ORIGIN.test(origin);
}

/** True for the app's own address, any extra configured address, or (outside production only) localhost. */
export function trustedOrigin(origin: string | undefined | null): origin is string {
  if (!origin) return false;
  const app = process.env.APP_URL?.replace(/\/+$/, "");
  if ((app && origin === app) || extraTrustedOrigins().includes(origin)) return true;
  return process.env.NODE_ENV !== "production" && isLoopbackOrigin(origin);
}
