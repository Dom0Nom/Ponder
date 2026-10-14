import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BorderBeam } from "border-beam";
import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { useIsDark } from "../../app/useTheme";
import { ActivityOrb } from "../../components/motion/ActivityOrb";
import { Button } from "../../components/ui/button";
import { Checkbox16 } from "../../components/ui/checkbox";
import { Input, fieldLabel } from "../../components/ui/input";
import { ErrorState, Segmented, Skeleton, Switch } from "../../components/ui/misc";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { effectiveLanguage, languageName } from "../../lib/i18n/language";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import type { Space } from "../../lib/types";
import { dayLabel } from "../../lib/utils";
import { generateSheet, NoMaterialError, sheetMaterial } from "../../lib/worksheets/generate";
import { optionLabel, paperFor, sheetLabels } from "../../lib/worksheets/labels";
import { ALL_TASK_TYPES, optionsFor, PRESETS, scaleOf } from "../../lib/worksheets/presets";
import { DIFFICULTIES, LABEL_STYLES, PRESET_IDS, type LabelStyle, type PresetId, type SheetOptions, type TaskType } from "../../lib/worksheets/types";
import { useUi } from "../../stores/ui";
import { NativeSelect } from "../settings/NativeSelect";
import { StudioSubpanel } from "../space/StudioSubpanel";
import { qkWorksheets } from "./WorksheetScreen";

const LANGS = ["en", "de", "fr", "es", "it", "nl", "pt", "pl", "tr"];

export function WorksheetBuilder({ space, onBack }: { space: Space; onBack: () => void }) {
  const qc = useQueryClient();
  const navigate = useUi((st) => st.navigate);
  const seed = useUi((st) => st.worksheetSeed);
  const dark = useIsDark();
  const spaceLang = effectiveLanguage(space.language);
  const [preset, setPreset] = useState<PresetId>(spaceLang.startsWith("de") ? "arbeitsblatt" : "international");
  const [o, setO] = useState<SheetOptions>(() => optionsFor(spaceLang.startsWith("de") ? "arbeitsblatt" : "international", spaceLang));
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const abort = useRef<AbortController | null>(null);
  const saved = useQuery({ queryKey: qkWorksheets(space.id), queryFn: () => api.worksheetsList(space.id) });

  useEffect(() => {
    if (!seed) return;
    setO((cur) => ({ ...cur, topic: seed.topic ?? cur.topic, source: seed.source ?? (seed.topic ? "topic" : cur.source) }));
    useUi.getState().clearWorksheetSeed();
  }, [seed]);

  useEffect(() => () => abort.current?.abort(), []);

  const patch = (p: Partial<SheetOptions>) => setO((cur) => ({ ...cur, ...p }));
  const pickPreset = (id: PresetId) => {
    setPreset(id);
    setO((cur) => optionsFor(id, spaceLang, { topic: cur.topic, source: cur.source }));
  };
  const toggleType = (t: TaskType) => patch({ taskTypes: o.taskTypes.includes(t) ? o.taskTypes.filter((x) => x !== t) : [...o.taskTypes, t] });
  const setLanguage = (language: string) => patch({ language, paper: paperFor(language, undefined) === "letter" ? "letter" : PRESETS[preset].defaults.paper ?? "a4" });

  const l = sheetLabels(o.language);
  const langs = LANGS.includes(o.language) ? LANGS : [o.language, ...LANGS];

  const generate = async () => {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRunning(true);
    setError(null);
    try {
      const llm = await resolveChatModel(space).catch((e) => {
        throw e instanceof NoModelError ? new Error(s.chat.noModel) : e;
      });
      const material = await sheetMaterial(space.id, o, llm);
      const made = await generateSheet(llm, o, material, { signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      const { replaced: _replaced, ...sheet } = made;
      const doc = await api.worksheetSave({ spaceId: space.id, title: sheet.title, sheet, attempt: null });
      void qc.invalidateQueries({ queryKey: qkWorksheets(space.id) });
      navigate({ name: "worksheet", spaceId: space.id, worksheetId: doc.id });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(e instanceof NoMaterialError ? new Error(o.source === "mistakes" ? s.worksheets.noMistakes : s.outputs.noMaterial) : e);
    } finally {
      if (abort.current === ctrl) setRunning(false);
    }
  };

  const showScale = o.scale.id === "notenschluessel" || o.scale.id === "letter";

  return (
    <StudioSubpanel title={s.worksheets.title} onBack={onBack} testId="worksheet-builder">
      <div className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <span className={fieldLabel}>{s.worksheets.source}</span>
          <Segmented
            label={s.worksheets.source}
            value={o.source}
            onChange={(source) => patch({ source })}
            options={[
              { value: "sources", label: s.worksheets.from.sources },
              { value: "topic", label: s.worksheets.from.topic },
              { value: "mistakes", label: s.worksheets.from.mistakes },
              { value: "chat", label: s.worksheets.from.chat },
            ]}
            block
            size="sm"
          />
        </div>
        {(o.source === "sources" || o.source === "topic") && (
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>{s.outputs.focusLabel}</span>
            <Input value={o.topic} onChange={(e) => patch({ topic: e.target.value })} placeholder={s.outputs.focusPlaceholder} data-testid="ws-topic" />
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>{s.worksheets.preset}</span>
          <NativeSelect value={preset} onChange={(e) => pickPreset(e.target.value as PresetId)} data-testid="ws-preset">
            {PRESET_IDS.map((id) => (
              <option key={id} value={id}>
                {s.worksheets.presets[id].name}
              </option>
            ))}
          </NativeSelect>
          <span className="text-label text-muted">{s.worksheets.presets[preset].meta}</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>{s.worksheets.language}</span>
            <NativeSelect value={o.language} onChange={(e) => setLanguage(e.target.value)} data-testid="ws-language">
              {langs.map((c) => (
                <option key={c} value={c}>
                  {languageName(c)}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>{s.worksheets.difficulty}</span>
            <NativeSelect value={o.difficulty} onChange={(e) => patch({ difficulty: e.target.value as SheetOptions["difficulty"] })}>
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {s.worksheets.difficulties[d]}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={fieldLabel}>{s.worksheets.size}</span>
          <div className="flex items-center gap-3">
            <Segmented
              label={s.worksheets.size}
              value={o.mode}
              onChange={(mode) => patch({ mode })}
              options={[
                { value: "length", label: s.worksheets.byLength },
                { value: "points", label: s.worksheets.byPoints },
              ]}
              size="sm"
            />
            {o.mode === "length" ? (
              <Input type="number" min={2} max={14} aria-label={s.worksheets.byLength} className="w-20" value={o.taskCount} onChange={(e) => patch({ taskCount: Math.max(2, Math.min(14, Number(e.target.value) || 2)) })} />
            ) : (
              <Input type="number" min={5} max={200} aria-label={s.worksheets.byPoints} className="w-20" value={o.totalPoints} onChange={(e) => patch({ totalPoints: Math.max(5, Math.min(200, Number(e.target.value) || 5)) })} />
            )}
          </div>
        </div>
        <fieldset className="flex flex-col gap-1.5" data-testid="ws-types">
          <legend className={fieldLabel}>{s.worksheets.taskTypes}</legend>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {ALL_TASK_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-2 text-body">
                <Checkbox16 checked={o.taskTypes.includes(t)} onChange={() => toggleType(t)} />
                {l.types[t]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>{s.worksheets.labelStyle}</span>
            <NativeSelect value={o.labelStyle} onChange={(e) => patch({ labelStyle: e.target.value as LabelStyle })} data-testid="ws-labels">
              {LABEL_STYLES.map((st) => (
                <option key={st} value={st}>
                  {[0, 1, 2].map((i) => optionLabel(st, i)).join(" ")}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>{s.worksheets.optionCount}</span>
            <NativeSelect value={o.optionCount} onChange={(e) => patch({ optionCount: Number(e.target.value) })} data-testid="ws-options">
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
        <label className="flex items-center gap-2 text-body">
          <Switch checked={o.multiCorrect} onCheckedChange={(multiCorrect) => patch({ multiCorrect })} label={s.worksheets.multiCorrect} />
          {s.worksheets.multiCorrect}
        </label>
        <label className="flex items-center gap-2 text-body">
          <Switch checked={o.wordBank} onCheckedChange={(wordBank) => patch({ wordBank })} label={s.worksheets.wordBank} />
          {s.worksheets.wordBank}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>{s.worksheets.scale}</span>
          <NativeSelect value={o.scale.id} onChange={(e) => patch({ scale: scaleOf(e.target.value as SheetOptions["scale"]["id"]) })} data-testid="ws-scale">
            {(["none", "notenschluessel", "letter", "ged"] as const).map((id) => (
              <option key={id} value={id}>
                {s.worksheets.scales[id]}
              </option>
            ))}
          </NativeSelect>
        </label>
        {showScale && (
          <div className="flex flex-wrap gap-2" data-testid="ws-thresholds">
            {o.scale.thresholds.map((t, i) => (
              <label key={i} className="flex flex-col gap-1 text-label text-muted">
                {o.scale.id === "letter" ? "ABCD"[i] : i + 1} ≥ %
                <Input
                  type="number"
                  min={0}
                  max={100}
                  className="h-8 w-16"
                  value={t}
                  onChange={(e) => patch({ scale: { ...o.scale, thresholds: o.scale.thresholds.map((x, k) => (k === i ? Number(e.target.value) : x)) } })}
                />
              </label>
            ))}
          </div>
        )}
        <label className="flex flex-col gap-1.5">
          <span className={fieldLabel}>{s.worksheets.paper}</span>
          <NativeSelect value={o.paper} onChange={(e) => patch({ paper: e.target.value as "a4" | "letter" })}>
            <option value="a4">{s.worksheets.paperA4}</option>
            <option value="letter">{s.worksheets.paperLetter}</option>
          </NativeSelect>
        </label>
      </div>
      {running ? (
        <BorderBeam size="md" colorVariant="mono" theme={dark ? "dark" : "light"} active duration={2.4} strength={0.8} borderRadius={10}>
          <div className="flex items-center gap-3 rounded-card border border-border px-3.5 py-3" data-testid="worksheet-generating" aria-live="polite">
            <ActivityOrb activity="write" size={32} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">{s.worksheets.generating}</span>
              <span className="text-label text-muted">{s.outputs.creatingNote}</span>
            </div>
            <Button variant="secondary" size="sm" onClick={() => abort.current?.abort() ?? setRunning(false)}>
              {s.outputs.cancel}
            </Button>
          </div>
        </BorderBeam>
      ) : (
        <Button variant="primary" onClick={() => void generate()} disabled={!o.taskTypes.length} data-testid="ws-generate" className="self-start">
          <FileText size={14} />
          {s.worksheets.generate}
        </Button>
      )}
      {error != null && !running && <ErrorState size="sm" title={s.worksheets.failed} error={error} onRetry={() => void generate()} />}
      <h3 className="pt-2 text-label font-semibold text-muted">{s.worksheets.saved}</h3>
      {saved.isLoading && <Skeleton className="h-10" />}
      {saved.error && <ErrorState size="sm" title={s.worksheets.loadFailed} error={saved.error} onRetry={() => saved.refetch()} />}
      {saved.data && saved.data.length === 0 && <p className="text-body text-muted">{s.worksheets.empty}</p>}
      {saved.data && saved.data.length > 0 && (
        <ul className="flex flex-col" data-testid="worksheets-list">
          {saved.data.map((w) => (
            <li key={w.id} className="border-b border-divider first:border-t">
              <button
                type="button"
                onClick={() => navigate({ name: "worksheet", spaceId: space.id, worksheetId: w.id })}
                className="-mx-1 flex h-9.75 w-[calc(100%+8px)] items-center gap-2.5 px-1 text-start text-body hover:bg-fill-subtle"
              >
                <FileText size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate font-medium">{w.title}</span>
                <span className="shrink-0 text-label text-muted">{dayLabel(w.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </StudioSubpanel>
  );
}
