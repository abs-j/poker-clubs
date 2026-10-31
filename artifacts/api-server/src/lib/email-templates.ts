// The emails the app sends. Plain, readable in any mail client, with a text version of each.
// Pure functions, so they can be unit tested.
import type { EmailMessage } from "./email";

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const appName = () => process.env.APP_NAME?.trim() || "Poker Clubs";

function layout(input: { heading: string; paragraphs: string[]; button: { label: string; url: string }; footer: string }): { html: string; text: string } {
  const app = escapeHtml(appName());
  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f1fa;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d1630">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td style="font-size:13px;font-weight:700;letter-spacing:.08em;color:#7735e9;text-transform:uppercase">${app}</td></tr>
<tr><td style="padding-top:12px;font-size:22px;font-weight:700">${escapeHtml(input.heading)}</td></tr>
${input.paragraphs.map((p) => `<tr><td style="padding-top:14px;font-size:15px;line-height:1.6">${escapeHtml(p)}</td></tr>`).join("\n")}
<tr><td style="padding-top:24px"><a href="${escapeHtml(input.button.url)}" style="display:inline-block;background:#7735e9;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:12px">${escapeHtml(input.button.label)}</a></td></tr>
<tr><td style="padding-top:20px;font-size:12px;line-height:1.5;color:#6b6480">If the button doesn't work, paste this link into your browser:<br><span style="word-break:break-all">${escapeHtml(input.button.url)}</span></td></tr>
<tr><td style="padding-top:24px;font-size:12px;line-height:1.5;color:#6b6480">${escapeHtml(input.footer)}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [input.heading, "", ...input.paragraphs.flatMap((p) => [p, ""]), `${input.button.label}: ${input.button.url}`, "", input.footer].join("\n");
  return { html, text };
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

export function verifyEmailMessage(input: { to: string; name: string; url: string }): EmailMessage {
  const { html, text } = layout({
    heading: "Confirm your email",
    paragraphs: [`Hi ${firstName(input.name)}, confirm this address so you can recover your account if you ever forget your password.`],
    button: { label: "Confirm email", url: input.url },
    footer: "This link works for one hour. If you didn't create an account, you can ignore this email.",
  });
  return { to: input.to, subject: `Confirm your email for ${appName()}`, html, text };
}

export function resetPasswordMessage(input: { to: string; name: string; url: string }): EmailMessage {
  const { html, text } = layout({
    heading: "Reset your password",
    paragraphs: [`Hi ${firstName(input.name)}, we got a request to reset your password. Choose a new one with the button below.`],
    button: { label: "Choose a new password", url: input.url },
    footer: "This link works for one hour and can be used once. If you didn't ask for this, you can ignore this email and your password stays as it is.",
  });
  return { to: input.to, subject: `Reset your ${appName()} password`, html, text };
}
