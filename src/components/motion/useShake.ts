import { useState } from "react";

/** Error shake (Transitions.dev Error state shake): spread `props` on the element, call `shake()` on a wrong answer. */
export function useShake() {
  const [shaking, setShaking] = useState(false);
  return {
    shake: () => setShaking(true),
    reset: () => setShaking(false),
    cls: (error?: boolean | null) => ["t-input", error && "is-error", shaking && "is-shaking"].filter(Boolean).join(" "),
    props: { onAnimationEnd: () => setShaking(false) },
  };
}
