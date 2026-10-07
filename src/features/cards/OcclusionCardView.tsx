import { useCallback, useEffect, useState } from "react";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import type { Card } from "../../lib/types";
import { cn } from "../../lib/utils";
import { ErrorState, Skeleton } from "../../components/ui/misc";

const imageCache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

export function loadImage(name: string): Promise<string> {
  const hit = imageCache.get(name);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(name);
  if (!p) {
    p = api
      .imageRead(name)
      .then((url) => {
        imageCache.set(name, url);
        return url;
      })
      .finally(() => pending.delete(name));
    pending.set(name, p);
  }
  return p;
}

/** Data URL of a stored image, cached for the session. */
export function useImageUrl(name: string | null | undefined) {
  const [state, setState] = useState<{ url?: string; error?: unknown; loading: boolean }>(() =>
    name && imageCache.has(name) ? { url: imageCache.get(name), loading: false } : { loading: !!name },
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!name) return setState({ loading: false });
    const hit = imageCache.get(name);
    if (hit) return setState({ url: hit, loading: false });
    let live = true;
    setState({ loading: true });
    loadImage(name).then(
      (url) => live && setState({ url, loading: false }),
      (error) => live && setState({ error, loading: false }),
    );
    return () => {
      live = false;
    };
  }, [name, attempt]);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  return { ...state, retry };
}

/** Image-occlusion card for review: the tested box is solid until `revealed`. */
export function OcclusionCardView({ card, revealed, className }: { card: Card; revealed: boolean; className?: string }) {
  const image = card.data?.image;
  const masks = card.data?.masks ?? [];
  const hideAll = !!card.data?.hideAll;
  const { url, error, loading, retry } = useImageUrl(image);

  if (!image) return <ErrorState title={s.occlusion.missingImage} error="" className={className} />;
  if (error) return <ErrorState title={s.occlusion.imageFailed} error={error} onRetry={retry} className={className} />;
  if (loading || !url)
    return <Skeleton className={cn("mx-auto aspect-[4/3] w-full max-w-xl rounded-pane", className)} />;

  return (
    <div className={cn("flex justify-center", className)} data-testid="occlusion-card">
      <div className="relative inline-block max-w-full">
        <img src={url} alt="" draggable={false} className="block max-h-[60vh] max-w-full select-none rounded-pane" />
        {masks.map((m) => {
          const tested = m.id === card.data?.mask;
          if (!tested && !hideAll) return null;
          const show = tested && revealed;
          return (
            <div
              key={m.id}
              role="img"
              aria-label={tested ? (show && m.label ? m.label : s.occlusion.tested) : s.occlusion.hidden}
              data-tested={tested || undefined}
              className={cn(
                "absolute rounded-kbd border-2 transition-colors duration-200",
                show ? "border-fg bg-transparent" : tested ? "border-fg bg-fg" : "border-faint bg-border",
              )}
              style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }}
            >
              {show && m.label && (
                <span
                  className={cn(
                    "absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-label font-semibold text-on-primary",
                    m.y + m.h > 0.85 ? "bottom-full mb-1" : "top-full mt-1",
                  )}
                >
                  {m.label}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
