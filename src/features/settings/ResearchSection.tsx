import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Textarea, Label } from "../../components/ui/input";
import { toastError } from "../../components/ui/toast";
import { useSetSetting, useSettings } from "../../lib/queries";
import { RESEARCH_MODEL_KEY, RESEARCH_PROMPT_KEY, researchSettings } from "../../lib/research/config";
import { DEFAULT_RESEARCH_SYSTEM_PROMPT } from "../../lib/research/prompts";
import { s } from "../../lib/strings";
import { ModelPicker } from "./ModelPicker";

export function ResearchSection() {
  const { data: settings } = useSettings();
  const setSetting = useSetSetting();
  const cfg = researchSettings(settings);
  const [draft, setDraft] = useState(cfg.systemPrompt);
  useEffect(() => setDraft(cfg.systemPrompt), [cfg.systemPrompt]);

  const save = (key: string, value: unknown) =>
    setSetting.mutate({ key, value }, { onError: (e) => toastError(s.errors.generic, e) });

  return (
    <div className="flex flex-col gap-3.5">
      <ModelPicker
        className="w-80"
        allowDefault
        defaultLabel={s.research.sameAsChat}
        value={cfg.model}
        onChange={(v) => save(RESEARCH_MODEL_KEY, v)}
      />
      <div>
        <Label htmlFor="research-system-prompt">{s.research.promptLabel}</Label>
        <Textarea
          id="research-system-prompt"
          rows={7}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const v = draft.trim();
            if (v === cfg.systemPrompt.trim()) return;
            save(RESEARCH_PROMPT_KEY, !v || v === DEFAULT_RESEARCH_SYSTEM_PROMPT ? null : draft);
          }}
          className="resize-y"
        />
        <div className="mt-2">
          <Button size="sm" variant="ghost" disabled={!cfg.customPrompt && draft === DEFAULT_RESEARCH_SYSTEM_PROMPT} onClick={() => save(RESEARCH_PROMPT_KEY, null)}>
            {s.research.resetPrompt}
          </Button>
        </div>
      </div>
    </div>
  );
}
