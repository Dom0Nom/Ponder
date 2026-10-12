import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Slider } from "../../components/ui/slider";
import { toast, toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { useProviders, useSetSetting } from "../../lib/queries";
import { s } from "../../lib/strings";
import { speak, stopSpeaking, usePlayer } from "../../lib/tts/player";
import { DEFAULT_MODEL, KEYED_SPEECH, openRouterAudioModels, SPEECH_KEY, SPEECH_SERVICES, type SpeechModel, type SpeechService, type SpeechSettings } from "../../lib/tts/speech";
import { useSpeechConfig } from "../speech/useSpeech";
import { SettingsGroup, SettingsRow } from "./layout";
import { NativeSelect } from "./NativeSelect";

const modelLabel = (m: SpeechModel) => (m.free ? `${m.name} (${s.speech.free})` : m.name);

export function VoiceSection() {
  const { cfg, ready } = useSpeechConfig();
  const { data: providers } = useProviders();
  const setSetting = useSetSetting();
  const save = (patch: Partial<SpeechSettings>) =>
    setSetting.mutate({ key: SPEECH_KEY, value: { ...cfg, ...patch } }, { onError: (e) => toastError(s.errors.generic, e) });
  const hasOpenRouter = !!providers?.some((p) => p.type === "openrouter");
  const sample = usePlayer((st) => (st.key === "voice-sample" ? st.status : "idle"));

  const trySample = () => speak("voice-sample", s.speech.sample).catch((e) => toastError(s.speech.failed, e, trySample));

  return (
    <SettingsGroup data-testid="voice-settings">
      <SettingsRow title={s.speech.service} description={ready ? undefined : KEYED_SPEECH[cfg.service] ? undefined : s.speech.noProvider(s.speech.services[cfg.service])}>
        <NativeSelect
          aria-label={s.speech.service}
          className="w-56"
          value={cfg.service}
          onChange={(e) => {
            const service = e.target.value as SpeechService;
            save({ service, ...DEFAULT_MODEL[service] });
          }}
        >
          {SPEECH_SERVICES.map((id) => (
            <option key={id} value={id}>
              {s.speech.services[id]}
            </option>
          ))}
        </NativeSelect>
      </SettingsRow>
      {KEYED_SPEECH[cfg.service] && <SpeechKeyRow id={KEYED_SPEECH[cfg.service]!} name={s.speech.services[cfg.service]} />}
      {cfg.service === "openrouter" && ready ? (
        <OpenRouterVoice cfg={cfg} save={save} />
      ) : (
        <>
          <TextRow label={s.speech.model} value={cfg.model} onSave={(model) => save({ model: model || DEFAULT_MODEL[cfg.service].model })} />
          <TextRow label={cfg.service === "elevenlabs" || cfg.service === "fish" ? s.speech.voiceId : s.speech.voice} value={cfg.voice} onSave={(voice) => save({ voice })} />
        </>
      )}
      <SettingsRow title={s.speech.speed}>
        <Slider label={s.speech.speed} min={0.5} max={2} step={0.25} value={cfg.speed} format={s.speech.speedValue} onChange={(speed) => save({ speed })} />
      </SettingsRow>
      {hasOpenRouter && <SttRow cfg={cfg} save={save} />}
      <SettingsRow title={s.speech.tryIt}>
        <Button size="sm" variant="secondary" disabled={!ready} onClick={() => (sample === "idle" ? void trySample() : stopSpeaking())}>
          {sample === "idle" ? s.speech.listen : sample === "loading" ? s.speech.preparing : s.speech.stop}
        </Button>
      </SettingsRow>
    </SettingsGroup>
  );
}

function useAudioModels(kind: "speech" | "transcription") {
  return useQuery({ queryKey: ["audio-models", kind], queryFn: () => openRouterAudioModels(kind), staleTime: 60 * 60_000, retry: false });
}

function OpenRouterVoice({ cfg, save }: { cfg: SpeechSettings; save: (p: Partial<SpeechSettings>) => void }) {
  const models = useAudioModels("speech");
  if (models.isError) return <SettingsRow title={s.speech.model} description={s.speech.modelsFailed} />;
  const list = models.data ?? [];
  const picked = list.find((m) => m.id === cfg.model);
  const options = picked || !cfg.model ? list : [{ id: cfg.model, name: cfg.model, voices: [], free: false }, ...list];
  const voices = picked?.voices ?? [];
  return (
    <>
      <SettingsRow title={s.speech.model} description={models.isLoading ? s.speech.loadingModels : undefined}>
        <NativeSelect
          aria-label={s.speech.model}
          className="w-56"
          value={cfg.model}
          disabled={models.isLoading}
          onChange={(e) => {
            const m = list.find((x) => x.id === e.target.value);
            save({ model: e.target.value, voice: m?.voices.includes(cfg.voice) ? cfg.voice : (m?.voices[0] ?? "") });
          }}
        >
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {modelLabel(m)}
            </option>
          ))}
        </NativeSelect>
      </SettingsRow>
      <SettingsRow title={s.speech.voice}>
        <NativeSelect aria-label={s.speech.voice} className="w-56" value={cfg.voice} disabled={!voices.length} onChange={(e) => save({ voice: e.target.value })}>
          {!voices.length && <option value="">{s.speech.defaultVoice}</option>}
          {voices.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </NativeSelect>
      </SettingsRow>
    </>
  );
}

function SttRow({ cfg, save }: { cfg: SpeechSettings; save: (p: Partial<SpeechSettings>) => void }) {
  const models = useAudioModels("transcription");
  const list = models.data ?? [];
  const options = list.some((m) => m.id === cfg.sttModel) ? list : [{ id: cfg.sttModel, name: cfg.sttModel, voices: [], free: false }, ...list];
  return (
    <SettingsRow title={s.speech.sttModel} description={s.speech.sttBody}>
      <NativeSelect aria-label={s.speech.sttModel} className="w-56" value={cfg.sttModel} disabled={models.isLoading} onChange={(e) => save({ sttModel: e.target.value })}>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {modelLabel(m)}
          </option>
        ))}
      </NativeSelect>
    </SettingsRow>
  );
}

function TextRow({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <SettingsRow title={label}>
      <Input
        aria-label={label}
        className="w-56"
        value={draft}
        placeholder={s.speech.voiceIdPlaceholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() !== value && onSave(draft.trim())}
      />
    </SettingsRow>
  );
}

function SpeechKeyRow({ id, name }: { id: string; name: string }) {
  const qc = useQueryClient();
  const has = useQuery({ queryKey: ["secret", id], queryFn: () => api.hasSecret(id) });
  const [draft, setDraft] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["secret", id] });
  const title = s.speech.keyTitle(name);
  const saveKey = useMutation({
    mutationFn: () => api.setSecret(id, draft.trim()),
    onSuccess: () => {
      setDraft("");
      refresh();
      toast.success(s.research.engines.keySaved(name));
    },
    onError: (e) => toastError(s.errors.generic, e),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteSecret(id),
    onSuccess: () => {
      refresh();
      toast.success(s.research.engines.keyRemoved(name));
    },
    onError: (e) => toastError(s.errors.generic, e),
  });
  return (
    <SettingsRow title={title} description={has.data ? s.research.engines.saved : undefined}>
      {has.data ? (
        <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()} aria-label={`${s.research.engines.removeKey} ${title}`}>
          {s.research.engines.removeKey}
        </Button>
      ) : (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) saveKey.mutate();
          }}
        >
          <Input type="password" autoComplete="off" aria-label={title} placeholder={s.research.engines.keyPlaceholder} value={draft} className="w-48" onChange={(e) => setDraft(e.target.value)} />
          <Button size="sm" variant="secondary" type="submit" disabled={!draft.trim() || saveKey.isPending}>
            {s.research.engines.saveKey}
          </Button>
        </form>
      )}
    </SettingsRow>
  );
}
