import { Plug } from "lucide-react";
import { useState } from "react";
import { authorIconUrl, providerIconUrl } from "../lib/providers/icons";
import { authorSites, hostOfBaseUrl } from "../lib/providers/openrouter";
import { useSiteIcon } from "../lib/queries";
import type { ProviderType } from "../lib/types";
import { cn } from "../lib/utils";

/** True when every visible pixel is near-white, i.e. the mark would vanish on a light tile. */
function isLightOnly(img: HTMLImageElement): boolean {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 24;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, 24, 24);
    const d = ctx.getImageData(0, 0, 24, 24).data;
    let seen = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 40) continue;
      seen++;
      if ((d[i] + d[i + 1] + d[i + 2]) / 3 < 225) return false;
    }
    return seen > 8;
  } catch {
    return false;
  }
}

/** A provider's own logo on a fixed light tile so dark marks stay visible in dark mode. Falls back to the site's icon, then a plug. */
export function ProviderIcon({
  type,
  author,
  baseUrl,
  size = 18,
  className,
}: {
  type?: ProviderType;
  author?: string;
  baseUrl?: string | null;
  size?: number;
  className?: string;
}) {
  const bundled = type ? providerIconUrl(type) : author ? authorIconUrl(author) : undefined;
  const sites = bundled ? [] : type ? [hostOfBaseUrl(baseUrl)].filter((h): h is string => !!h) : author ? authorSites(author) : [];
  const fetched = useSiteIcon(sites);
  const [broken, setBroken] = useState<string | null>(null);
  const [lightOnly, setLightOnly] = useState<string | null>(null);
  const candidate = bundled ?? fetched;
  const url = candidate && candidate !== broken ? candidate : undefined;
  const box = { width: size, height: size };
  if (!url)
    return (
      <span aria-hidden style={box} className={cn("flex shrink-0 items-center justify-center rounded-kbd bg-chip text-muted", className)}>
        <Plug size={Math.round(size * 0.65)} />
      </span>
    );
  return (
    <span aria-hidden style={box} className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-kbd", lightOnly === url ? "bg-icon-tile-dark" : "bg-icon-tile", className)}>
      <img src={url} alt="" width={size} height={size} draggable={false} onError={() => setBroken(url)}
        onLoad={bundled ? undefined : (e) => isLightOnly(e.currentTarget) && setLightOnly(url)} className="size-full object-contain" />
    </span>
  );
}
