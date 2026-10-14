import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/input";
import { toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { useProviders } from "../../lib/queries";
import { s } from "../../lib/strings";
import { DEFAULT_MODEL, KEYED_SPEECH, SPEECH_KEY, type SpeechService } from "../../lib/tts/speech";
import { useSpeechConfig } from "../speech/useSpeech";
import { NativeSelect } from "../settings/NativeSelect";
import { Choice, Heading } from "./parts";
import { useOb } from "./state";

type Mode = "off" | "local" | "provider";
const SERVICES = ["openrouter", "elevenlabs", "fish"] as const satisfies readonly SpeechService[];
const MODE_KEY = "onboardingVoice";

function KeyField({ id, name }: { id: string; name: string }) {
  const qc = useQueryClient();
  const has = useQuery({ queryKey: ["secret", id], queryFn: () => api.hasSecret(id) });
  const [draft, setDraft] = useState("");
  const ob = s.onboarding.voice;
  const save = async () => {
    try {
      await api.setSecret(id, draft.trim());
      setDraft("");
      qc.invalidateQueries({ queryKey: ["secret", id] });
    } catch (e) {
      toastError(s.errors.generic, e);
    }
  };
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim()) void save();
      }}
    >
      <div className="flex-1">
        <Label htmlFor="ob-voice-key">{ob.keyLabel(name)}</Label>
        <Input id="ob-voice-key" type="password" autoComplete="off" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </div>
      <Button variant="secondary" type="submit" disabled={!draft.trim()}>
        {has.data && !draft ? ob.keySaved : ob.saveKey}
      </Button>
    </form>
  );
}

export function VoiceStep() {
  const { settings, save } = useOb();
  const { cfg } = useSpeechConfig();
  const { data: providers } = useProviders();
  const ob = s.onboarding.voice;
  const stored = settings?.[MODE_KEY];
  const [mode, setMode] = useState<Mode>(stored === "local" || stored === "provider" ? stored : "off");
  const [service, setService] = useState<(typeof SERVICES)[number]>(SERVICES.includes(cfg.service as never) ? (cfg.service as (typeof SERVICES)[number]) : "openrouter");

  const apply = (m: Mode, svc = service) => {
    setMode(m);
    const next = m === "local" ? "local" : svc;
    const writes = [save(MODE_KEY, m)];
    if (m !== "off") writes.push(save(SPEECH_KEY, { ...cfg, service: next, ...DEFAULT_MODEL[next] }));
    Promise.all(writes).catch((e) => toastError(s.errors.generic, e));
  };

  const hasOpenRouter = !!providers?.some((p) => p.type === "openrouter");
  return (
    <>
      <Heading title={ob.title} body={ob.body} />
      <div role="radiogroup" aria-label={ob.title} className="flex flex-col gap-3">
        <Choice index={0} selected={mode === "off"} onSelect={() => apply("off")} title={ob.off} body={ob.offBody} />
        <Choice index={1} selected={mode === "local"} onSelect={() => apply("local")} title={ob.local} body={ob.localBody} />
        <Choice index={2} selected={mode === "provider"} onSelect={() => apply("provider")} title={ob.provider} body={ob.providerBody}>
          {mode === "provider" && (
            <div className="mt-3 flex flex-col gap-3 rounded-card border border-border p-4">
              <div>
                <Label htmlFor="ob-voice-service">{ob.service}</Label>
                <NativeSelect
                  id="ob-voice-service"
                  value={service}
                  onChange={(e) => {
                    const v = e.target.value as (typeof SERVICES)[number];
                    setService(v);
                    apply("provider", v);
                  }}
                >
                  {SERVICES.map((v) => (
                    <option key={v} value={v}>
                      {s.speech.services[v]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {KEYED_SPEECH[service] ? (
                <KeyField id={KEYED_SPEECH[service]!} name={s.speech.services[service]} />
              ) : (
                !hasOpenRouter && <p className="text-body text-muted">{ob.needsOpenRouter}</p>
              )}
            </div>
          )}
        </Choice>
      </div>
    </>
  );
}
