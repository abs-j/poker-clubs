// Sending email through Resend (https://resend.com/docs/api-reference/emails/send-email).
// Three modes, chosen from the environment so nothing is sent by accident:
//   "resend": RESEND_API_KEY is set; mail goes out through Resend.
//   "log":    no key and not production; the email is logged and kept in memory so it can be
//             read in development and tests without an account.
//   "off":    no key in production; features that need email are switched off.

export type EmailMessage = { to: string; subject: string; text: string; html: string };
export type EmailMode = "resend" | "log" | "off";

export function emailMode(): EmailMode {
  if (process.env.RESEND_API_KEY) return "resend";
  return process.env.NODE_ENV === "production" ? "off" : "log";
}

/** The last emails "sent" in log mode, newest last. Never filled in resend mode. */
export const devOutbox: Array<EmailMessage & { at: string }> = [];
const OUTBOX_LIMIT = 50;

const DEFAULT_FROM = "Poker Clubs <onboarding@resend.dev>";
let warnedAboutSender = false;

export async function sendEmail(message: EmailMessage): Promise<void> {
  const mode = emailMode();
  if (mode === "off") throw new Error("Email is not configured on this server.");

  if (mode === "log") {
    devOutbox.push({ ...message, at: new Date().toISOString() });
    if (devOutbox.length > OUTBOX_LIMIT) devOutbox.shift();
    console.info(`[email:log] to=${message.to} subject="${message.subject}"\n${message.text}`);
    return;
  }

  const from = process.env.EMAIL_FROM?.trim();
  if (!from && !warnedAboutSender) {
    warnedAboutSender = true;
    console.warn("EMAIL_FROM is not set; using Resend's test sender, which can only deliver to your own Resend account address.");
  }
  const response = await fetch(`${process.env.RESEND_API_URL ?? "https://api.resend.com"}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: from || DEFAULT_FROM, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend returned ${response.status}: ${detail.slice(0, 200)}`);
  }
}
