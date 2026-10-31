import { useClubSettings } from "@/components/club-settings-context";
import { ClubBuzz } from "@/components/club-buzz";
import { ClubHome } from "@/components/club-panel";
import type { ChartSession } from "@/lib/club-charts";
import { PageIntro } from "./shared";

/** A club's own rules: paragraphs, "# headings" and "- bullets" from plain text. */
function ClubGuidelines({ text }: { text: string | null }) {
  const blocks = (text ?? "").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  return (
    <section data-testid="section-guidelines" className="space-y-4">
      <PageIntro eyebrow="Club guide / fair play" title="Club rules" description="How this club plays and keeps games friendly." count="Club reference" />
      <div className="soft-shadow rounded-2xl border border-border bg-card p-5 sm:p-6">
        {blocks.length === 0 ? (
          <p data-testid="text-guidelines-empty" className="text-sm leading-6 text-muted-foreground">
            This club hasn&apos;t written its rules yet. Club admins can add them under Admin, in Settings.
          </p>
        ) : (
          <div className="space-y-4" data-testid="text-club-guidelines">
            {blocks.map((block, index) => {
              const lines = block.split("\n");
              if (lines.every((line) => line.trim().startsWith("- "))) {
                return (
                  <ul key={index} className="list-disc space-y-1 pl-5 text-sm leading-6">
                    {lines.map((line) => <li key={line}>{line.trim().slice(2)}</li>)}
                  </ul>
                );
              }
              if (lines[0].startsWith("# ")) {
                return (
                  <div key={index}>
                    <h2 className="text-lg font-semibold">{lines[0].slice(2)}</h2>
                    {lines.length > 1 && <p className="mt-1 whitespace-pre-line text-sm leading-6">{lines.slice(1).join("\n")}</p>}
                  </div>
                );
              }
              return <p key={index} className="whitespace-pre-line text-sm leading-6">{block}</p>;
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export function GuidelinesView({ sessions, viewer, onOpenPlayer }: { sessions: ChartSession[]; viewer: string; onOpenPlayer: (name: string) => void }) {
  const { settings } = useClubSettings();
  return (
    <div className="space-y-4">
      <ClubGuidelines text={settings.guidelines} />
      <ClubBuzz sessions={sessions} viewer={viewer} onOpenPlayer={onOpenPlayer} />
      <ClubHome />
    </div>
  );
}
