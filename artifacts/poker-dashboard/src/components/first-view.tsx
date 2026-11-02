import { useEffect, useRef, type ReactNode } from "react";
import { isFirstViewDay, loadHomeSeen, localDateKey, saveHomeSeen, seenRecord, withSeen } from "@/lib/home-seen";

type FirstViewProps = {
  /** Which club, so a person in two clubs keeps separate flags. */
  scope: string;
  member: string;
  id: string | null;
  children: ReactNode;
};

/**
 * Renders children only on the first local day this id is actually on screen.
 * Seeing about 15% of the card records the day; a later day hides it until a newer game appears.
 */
export function FirstView({ scope, member, id, children }: FirstViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const today = localDateKey(new Date());
  const visible = Boolean(id) && isFirstViewDay(seenRecord(loadHomeSeen(), scope, member), id ?? "", today);

  useEffect(() => {
    if (!id || !visible) return;
    const node = ref.current;
    const mark = () => {
      const store = loadHomeSeen();
      const next = withSeen(store, scope, member, id, today);
      if (next !== store) saveHomeSeen(next);
    };
    if (!node || typeof IntersectionObserver === "undefined") {
      mark();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.15)) {
          mark();
          observer.disconnect();
        }
      },
      { threshold: [0, 0.15, 0.5] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [id, member, scope, today, visible]);

  if (!visible) return null;
  return <div ref={ref}>{children}</div>;
}
