import { useState } from "react";
import { Images } from "lucide-react";
import { RecapStudio } from "@/components/recap-studio";
import type { RecapPack } from "@/lib/recaps";

type RecapButtonProps = {
  /** Called once the button is opened, so the slides are only worked out when wanted. */
  build: () => RecapPack | null;
  testId: string;
  label?: string;
  variant?: "primary" | "outline";
  className?: string;
};

/** Opens the recap studio: Instagram-sized slides for a night or tournament. */
export function RecapButton({ build, testId, label = "Instagram slides", variant = "outline", className = "" }: RecapButtonProps) {
  const [open, setOpen] = useState(false);
  const pack = open ? build() : null;
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
        <Images className="h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </button>
      <RecapStudio open={open} onOpenChange={setOpen} pack={pack} />
    </>
  );
}
