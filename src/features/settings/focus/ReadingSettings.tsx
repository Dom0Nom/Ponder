import { Switch } from "../../../components/ui/misc";
import { toastError } from "../../../components/ui/toast";
import { useFocusPrefs, useSetFocusPref, type ReadingPrefs } from "../../../lib/focusPrefs";
import { s } from "../../../lib/strings";

export function ReadingSettings() {
  const { prefs } = useFocusPrefs();
  const setPref = useSetFocusPref();
  const toggle = (key: keyof ReadingPrefs) => (value: boolean) =>
    setPref("reading", { ...prefs.reading, [key]: value }).catch((e) => toastError(s.reading.saveFailed, e));

  const rows: { key: keyof ReadingPrefs; label: string; body: string }[] = [
    { key: "bionic", label: s.reading.bionic, body: s.reading.bionicBody },
    { key: "ruler", label: s.reading.ruler, body: s.reading.rulerBody },
  ];

  return (
    <div>
      <h3 className="text-sm font-medium">{s.reading.title}</h3>
      <p className="mt-0.5 text-[0.8125rem] text-muted">{s.reading.body}</p>
      <div className="mt-3 space-y-3">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm">{r.label}</p>
              <p className="text-xs text-muted">{r.body}</p>
            </div>
            <Switch checked={prefs.reading[r.key]} onCheckedChange={toggle(r.key)} label={r.label} />
          </div>
        ))}
      </div>
    </div>
  );
}
