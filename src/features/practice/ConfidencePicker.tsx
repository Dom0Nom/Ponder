import { useEffect } from "react";
import { Segmented } from "../../components/ui/misc";
import { CONFIDENCE_KEYS } from "../../lib/srs/confidence";
import { s } from "../../lib/strings";
import type { Confidence } from "../../lib/types";

const VALUES: Confidence[] = [0, 1, 2];

/** G / U / S keys work anywhere outside a text field; Alt+G/U/S works inside one too. */
export function useConfidenceKeys(onPick: (c: Confidence) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.repeat) return;
      const inField = !!(e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable=true], [role=dialog]");
      const letter = e.altKey ? e.code.replace("Key", "").toLowerCase() : e.key.toLowerCase();
      if (inField && !e.altKey) return;
      const c = CONFIDENCE_KEYS[letter];
      if (c === undefined) return;
      e.preventDefault();
      onPick(c);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPick, enabled]);
}

export function ConfidencePicker({ value, onChange, disabled }: { value: Confidence | null; onChange: (c: Confidence) => void; disabled?: boolean }) {
  useConfidenceKeys(onChange, !disabled);
  const labels = [s.confidence.guess, s.confidence.unsure, s.confidence.sure];
  return (
    <div className="flex items-center gap-3" data-testid="confidence" aria-keyshortcuts="G U S">
      <span className="text-label text-muted">{s.confidence.label}</span>
      <Segmented<string>
        size="sm"
        label={s.confidence.label}
        value={value == null ? "" : String(value)}
        onChange={(v) => onChange(Number(v) as Confidence)}
        options={VALUES.map((v) => ({ value: String(v), label: labels[v], title: "GUS"[v] }))}
      />
    </div>
  );
}
