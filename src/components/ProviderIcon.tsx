import { Plug } from "lucide-react";
import { useState } from "react";
import { authorIconUrl, providerIconUrl } from "../lib/providers/icons";
import { authorSites, hostOfBaseUrl } from "../lib/providers/openrouter";
import { useSiteIcon } from "../lib/queries";
import type { ProviderType } from "../lib/types";
import { cn } from "../lib/utils";

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
    <span aria-hidden style={box} className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-kbd bg-icon-tile", className)}>
      <img src={url} alt="" width={size} height={size} draggable={false} onError={() => setBroken(url)} className="size-full object-contain" />
    </span>
  );
}
