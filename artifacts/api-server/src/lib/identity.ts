import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, userAccounts, userSessions, userVerifications, users } from "@workspace/db";
import { emailMode, sendEmail } from "./email";
import { resetPasswordMessage, verifyEmailMessage } from "./email-templates";
import { logger } from "./logger";
import { extraTrustedOrigins, trustedOrigin } from "./origins";

// Who the person is (sign up, sign in, sessions). Which clubs they belong to, and as what,
// is ours: see club-access.ts and the memberships table.


/** Never awaited by the caller: a slow or failing mail provider must not change how fast, or whether, a request answers. */
const deliver = (message: Parameters<typeof sendEmail>[0], what: string) => {
  // With no mail provider the features that need email are hidden; there is nothing to report here.
  if (emailMode() === "off") return;
  void sendEmail(message).catch((error: unknown) => logger.error({ err: error, what }, "Could not send an email"));
};

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

/** True when the Google button should be offered. */
export const googleSignInEnabled = Boolean(googleClientId && googleClientSecret);

export const identity = betterAuth({
  basePath: "/api/identity",
  secret: process.env.SESSION_SECRET,
  // Left unset the base URL comes from the request, which works behind a proxy and in dev.
  baseURL: process.env.APP_URL || undefined,
  trustedOrigins: (request) => {
    const origins = [process.env.APP_URL, ...extraTrustedOrigins()];
    // The dev server proxies /api and rewrites the Host header, so the browser's own
    // localhost origin looks foreign. trustedOrigin allows that outside production only.
    const origin = request?.headers.get("origin");
    if (trustedOrigin(origin)) origins.push(origin);
    // Links in emails are opened without an Origin header, so in development the local app address
    // must be trusted as a place to send people back to. Never in production.
    if (process.env.NODE_ENV !== "production") origins.push("http://localhost:*", "http://127.0.0.1:*");
    return origins.filter((value): value is string => Boolean(value));
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: users, session: userSessions, account: userAccounts, verification: userVerifications },
  }),
  user: {
    additionalFields: {
      // Set by the sign-up form when the box is ticked. Not required, because Google sign-up has no such box.
      termsAcceptedAt: { type: "date", required: false, input: true },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
    // Invite links are the real gate, so a confirmed email is not required by default. Set
    // REQUIRE_EMAIL_VERIFICATION=true to insist on it (needs email to be configured).
    requireEmailVerification: process.env.REQUIRE_EMAIL_VERIFICATION === "true" && emailMode() !== "off",
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      deliver(resetPasswordMessage({ to: user.email, name: user.name, url }), "password reset");
    },
  },
  emailVerification: {
    sendOnSignUp: emailMode() !== "off",
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      deliver(verifyEmailMessage({ to: user.email, name: user.name, url }), "email verification");
    },
  },
  // Slow down guessing and mail bombing. Off outside production so local runs and tests are not throttled.
  rateLimit: {
    enabled: process.env.NODE_ENV === "production",
    window: 60,
    max: 100,
    customRules: {
      "/request-password-reset": { window: 15 * 60, max: 5 },
      "/send-verification-email": { window: 15 * 60, max: 5 },
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60 * 60, max: 20 },
    },
  },
  socialProviders: googleSignInEnabled
    ? { google: { clientId: googleClientId!, clientSecret: googleClientSecret! } }
    : {},
  session: {
    expiresIn: 60 * 60 * 24 * 90,
    updateAge: 60 * 60 * 24,
  },
});
