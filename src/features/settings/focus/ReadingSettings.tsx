import { Switch } from "../../../components/ui/misc";
import { toastError } from "../../../components/ui/toast";
import { useFocusPrefs, useSetFocusPref, type ReadingPrefs } from "../../../lib/focusPrefs";
import { s } from "../../../lib/strings";
import { SettingsRow } from "../layout";

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
    <>
      {rows.map((r) => (
        <SettingsRow key={r.key} title={r.label} description={r.body}>
          <Switch checked={prefs.reading[r.key]} onCheckedChange={toggle(r.key)} label={r.label} />
        </SettingsRow>
      ))}
    </>
  );
}
