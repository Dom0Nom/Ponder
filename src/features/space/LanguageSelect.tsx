import { LOCALES } from "../../lib/i18n/locales";
import { s } from "../../lib/strings";
import { NativeSelect } from "../settings/NativeSelect";

/** A space's language: the empty value follows the app language. */
export function LanguageSelect({ id, value, onChange }: { id: string; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <NativeSelect id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{s.space.languageApp}</option>
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code} lang={l.code}>
          {l.name}
        </option>
      ))}
    </NativeSelect>
  );
}
