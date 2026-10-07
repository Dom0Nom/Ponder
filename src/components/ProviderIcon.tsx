import { Plug } from "lucide-react";
import { authorIconUrl, providerIconUrl } from "../lib/providers/icons";
import type { ProviderType } from "../lib/types";
import { cn } from "../lib/utils";

/** A provider's own logo on a fixed light tile so dark marks stay visible in dark mode. */
export function ProviderIcon({
  type,
  author,
  size = 18,
  className,
}: {
  type?: ProviderType;
  author?: string;
  size?: number;
  className?: string;
}) {
  const url = type ? providerIconUrl(type) : author ? authorIconUrl(author) : undefined;
  const box = { width: size, height: size };
  if (!url)
    return (
      <span aria-hidden style={box} className={cn("flex shrink-0 items-center justify-center rounded-kbd bg-chip text-muted", className)}>
        <Plug size={Math.round(size * 0.65)} />
      </span>
    );
  return (
    <span aria-hidden style={box} className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-kbd bg-icon-tile", className)}>
      <img src={url} alt="" width={size} height={size} draggable={false} className="size-full object-contain" />
    </span>
  );
}
