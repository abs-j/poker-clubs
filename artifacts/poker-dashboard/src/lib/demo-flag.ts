/** True only in the static demo bundle (built with VITE_DEMO=true). The real site never sets it. */
export const IS_DEMO = import.meta.env.VITE_DEMO === "true";
