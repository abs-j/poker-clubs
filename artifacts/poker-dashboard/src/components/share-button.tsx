import { useState } from "react";
import { Share2 } from "lucide-react";
import { ShareImageDialog } from "@/components/share-image-dialog";
import type { GroupCardModel, ShareCardModel } from "@/lib/share-card";
import { clubName } from "@/lib/club-format";

type ShareButtonProps = {
  /** Builds the card. Called with true for the version that leaves money figures off. */
  build: (hideAmounts: boolean) => ShareCardModel | GroupCardModel | null;
  /** File name without extension. The club name is added in front. */
  fileSlug: string;
  caption: (hideAmounts: boolean) => string;
  testId: string;
  title?: string;
  description?: string;
  label?: string;
  variant?: "primary" | "outline";
  /** Cards with no money figures (club points) do not need the hide switch. */
  hasAmounts?: boolean;
  className?: string;
};

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** A Share button that opens the picture dialog. The card is only drawn once it is opened. */
export function ShareButton({ build, fileSlug, caption, testId, title, description, label = "Share", variant = "outline", hasAmounts = true, className = "" }: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const shown = open ? build(false) : null;
  const hidden = open && hasAmounts ? build(true) : null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid={testId}
        className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-semibold ${
          variant === "primary" ? "bg-primary text-primary-foreground shadow-sm hover:opacity-90" : "border border-border bg-background hover:bg-secondary"
        } ${className}`}
      >
        <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </button>
      {shown && (
        <ShareImageDialog
          open={open}
          onOpenChange={setOpen}
          model={shown}
          hiddenModel={hidden ?? undefined}
          fileName={`${slugify(clubName()) || "poker"}-${slugify(fileSlug)}.png`}
          shareText={caption(false)}
          hiddenShareText={caption(true)}
          title={title}
          description={description}
        />
      )}
    </>
  );
}
