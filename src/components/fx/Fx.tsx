import { Suspense, type ReactNode } from "react";
import { useVisualEffects } from "../../app/useTheme";
import { hasWebGL2 } from "../../lib/motion";
import { FxBoundary } from "./FxBoundary";

/** Renders `render()` only with Visual effects on and motion not reduced; otherwise `fallback`. */
export function Fx({ fallback, render, needsWebGL2 = false }: { fallback: ReactNode; render: () => ReactNode; needsWebGL2?: boolean }) {
  const on = useVisualEffects();
  if (!on || (needsWebGL2 && !hasWebGL2())) return <>{fallback}</>;
  return (
    <Suspense fallback={fallback}>
      <FxBoundary fallback={fallback}>{render()}</FxBoundary>
    </Suspense>
  );
}
