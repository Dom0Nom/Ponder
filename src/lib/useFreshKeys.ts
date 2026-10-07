import { useRef } from "react";

/** Keys that appeared after the list first loaded, so only genuinely new rows play an enter animation. */
export function useFreshKeys(keys: string[] | undefined): (key: string) => boolean {
  const known = useRef<Set<string> | null>(null);
  const fresh = useRef(new Set<string>());
  if (keys) {
    if (known.current === null) known.current = new Set(keys);
    else
      for (const k of keys)
        if (!known.current.has(k)) {
          known.current.add(k);
          fresh.current.add(k);
        }
  }
  return (key) => fresh.current.has(key);
}
