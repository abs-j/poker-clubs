import type { ReactNode } from "react";
import { Spade } from "lucide-react";
import { APP_NAME } from "@/lib/account-api";

// Plain-language terms and privacy notice for a free, invite-only record-keeping app. It says what
// the app really does. Replace the contact address (VITE_CONTACT_EMAIL) and have it reviewed before
// relying on it as legal advice: it is a starting point, not a substitute for a lawyer.

const CONTACT = (import.meta.env.VITE_CONTACT_EMAIL as string | undefined) || "";
const UPDATED = "31 October 2026";

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <main className="mx-auto max-w-2xl px-5 py-8">
        <a href="/" className="mb-6 flex items-center gap-3" data-testid="link-legal-home">
          <span className="brand-mark flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_3px_0_hsl(262_80%_40%)]">
            <Spade className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
        </a>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">Last updated {UPDATED}</p>
        <div className="mt-6 space-y-6 text-sm leading-7">{children}</div>
        <p className="mt-10 border-t border-border pt-4 text-xs text-muted-foreground">
          <a href="/terms" className="hover:text-primary hover:underline">Terms</a> · <a href="/privacy" className="hover:text-primary hover:underline">Privacy</a> · <a href="/delete-account" className="hover:text-primary hover:underline">Delete account</a> · <a href="/" className="hover:text-primary hover:underline">Back to {APP_NAME}</a>
        </p>
      </main>
    </div>
  );
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section>
    <h2 className="text-base font-semibold">{title}</h2>
    <div className="mt-1.5 space-y-2 text-muted-foreground">{children}</div>
  </section>
);

const Contact = () => (CONTACT ? <a className="text-primary underline" href={`mailto:${CONTACT}`}>{CONTACT}</a> : <>the person who runs this site</>);

export function TermsPage() {
  return (
    <Page title="Terms of use">
      <Section title="What this is">
        <p>{APP_NAME} is a free tool for groups to record the results of social poker nights: who bought in, who cashed out, leaderboards and club points. It is invite-only: you join a club with a link from that club.</p>
        <p><strong className="text-foreground">It does not run games, hold, move or pay out money, or take bets.</strong> It only keeps the numbers that members type in. Settling up is between the people at the table.</p>
      </Section>
      <Section title="You must be 18 or over">
        <p>By creating an account you confirm you are at least 18. Gambling and poker laws differ from place to place, and you are responsible for following the ones that apply to you and your club. If playing for money isn&apos;t allowed where you are, don&apos;t.</p>
      </Section>
      <Section title="Accounts and clubs">
        <p>Keep your password to yourself and tell us if you think someone else has your account. One person per account.</p>
        <p>Each club is run by its owner and admins. They can add or remove members, record, import and delete nights, and delete the club and everything in it. Club owners and admins can see the email addresses of their club&apos;s members. Usage of the site is visible only to the platform owner.</p>
      </Section>
      <Section title="What you enter">
        <p>You keep ownership of what you put in, such as names, results and pictures. You allow us to store it and show it to the other members of your club so the site works. Only enter things you have the right to share, and don&apos;t put other people&apos;s private details in.</p>
      </Section>
      <Section title="Behave">
        <p>Don&apos;t harass people, break the law, try to break or overload the site, or use it to send spam (including through the invite-by-email feature). We can remove accounts or clubs that do.</p>
      </Section>
      <Section title="No promises">
        <p>The site is provided free and as it is. Results are only as accurate as what was entered, so check them before settling up. We try to keep it running and your data safe, but we can&apos;t promise it will always be available or error-free, and we may change or stop it. To the extent the law allows, we aren&apos;t liable for losses from using it, including disputes between players about money.</p>
      </Section>
      <Section title="Questions">
        <p>Contact <Contact />.</p>
      </Section>
    </Page>
  );
}

export function PrivacyPage() {
  return (
    <Page title="Privacy">
      <Section title="What we collect">
        <p><strong className="text-foreground">Your account:</strong> your name, email address and a scrambled (hashed) version of your password. If you sign in with Google, we get your name and email from Google. We also keep sign-in records (when, device type and IP address) to keep accounts secure.</p>
        <p><strong className="text-foreground">Your club&apos;s records:</strong> the name you play under, buy-ins, cash-outs, results, tournaments, and an optional profile picture.</p>
        <p><strong className="text-foreground">How the site is used:</strong> which sections you open and for how long, and when you sign in. Usage is visible only to the platform owner.</p>
        <p><strong className="text-foreground">Invites:</strong> if an admin emails someone an invite, we use that address to send it and keep it with the invite.</p>
      </Section>
      <Section title="Who can see it">
        <p>Members of your club see the names and results in that club. Club owners and admins also see members&apos; email addresses. Usage is visible only to the platform owner, the person who runs this site. People in other clubs see nothing of yours. We don&apos;t sell your data or show ads.</p>
      </Section>
      <Section title="Who handles it for us">
        <p>Email is sent through Resend. If a club admin uploads a screenshot of results, the picture is sent to Anthropic (the maker of Claude) to read the text, and we don&apos;t keep the picture. The site and its database are hosted on Replit. If you choose Google sign-in, Google handles that sign-in. These providers only get what they need to do those jobs.</p>
      </Section>
      <Section title="Cookies">
        <p>Only the ones the site needs to work: staying signed in, remembering which club you are in, and which year you are viewing. No advertising or tracking cookies.</p>
      </Section>
      <Section title="Keeping and deleting">
        <p>We keep your data until you or your club delete it. You can delete your account any time from the Account page: that removes your login and email. The results you and your club recorded stay in the club under the player name, no longer linked to you, so the club&apos;s history isn&apos;t rewritten. A club owner can delete the club, which permanently deletes everything in it. To have a name or entry changed or removed, ask a club admin or contact us.</p>
      </Section>
      <Section title="Delete your account">
        <p>Step-by-step instructions are on the <a className="text-primary underline" href="/delete-account">account deletion page</a>.</p>
      </Section>
      <Section title="Your rights and contact">
        <p>You can ask to see, correct or delete the personal information we hold about you. Contact <Contact />.</p>
      </Section>
    </Page>
  );
}

export function AccountDeletionPage() {
  return (
    <Page title="Delete your account">
      <Section title="How to delete your account">
        <p>You can delete your account yourself, any time, in the app or on the website:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Sign in to {APP_NAME}.</li>
          <li>Open the Account page.</li>
          <li>Choose <strong className="text-foreground">Delete my account</strong>.</li>
          <li>Confirm: type your password, or your email address if you sign in with Google.</li>
          <li>Choose <strong className="text-foreground">Delete for good</strong>. This can&apos;t be undone.</li>
        </ol>
      </Section>
      <Section title="What is deleted">
        <p>Your login, your email address, your password (hashed) and your sign-in sessions are deleted straight away, and you are signed out. Your membership of every club is removed.</p>
        <p>If you are the owner of a club and the only member, that club is deleted with you, including every night, tournament and invite in it.</p>
      </Section>
      <Section title="What is kept">
        <p>The results you recorded stay in your clubs under the player name you used, but are no longer linked to you or your email, so the club&apos;s history isn&apos;t rewritten. A club admin can edit or remove a player name; ask them, or contact us.</p>
      </Section>
      <Section title="If you own a club that has other members">
        <p>Deletion is blocked until you either make another member the owner (in the club&apos;s member list, choose <strong className="text-foreground">Make owner</strong>), or delete the club. Only the owner can delete a club: open the club settings, choose <strong className="text-foreground">Delete club</strong> and type the club&apos;s exact name. Deleting a club permanently removes everything in it for all members, so download your results first if you want to keep them.</p>
      </Section>
      <Section title="Leaving one club without deleting your account">
        <p>Members who aren&apos;t the owner can leave a club from the club settings. Your account stays, and the player name and its history stay in that club, unlinked from you.</p>
      </Section>
      <Section title="Can&apos;t sign in, or prefer to ask?">
        <p>Email <Contact /> from the address on your account and ask for it to be deleted. We will confirm that it is yours and delete it, with the same effect as above.</p>
      </Section>
    </Page>
  );
}
