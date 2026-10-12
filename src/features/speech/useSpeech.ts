import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/ipc";
import { useProviders, useSettings } from "../../lib/queries";
import { KEYED_SPEECH, speechReady, speechSettings } from "../../lib/tts/speech";

export function useSpeechConfig() {
  const { data: settings } = useSettings();
  const { data: providers } = useProviders();
  const cfg = speechSettings(settings);
  const keyId = KEYED_SPEECH[cfg.service];
  const key = useQuery({ queryKey: ["secret", keyId], queryFn: () => api.hasSecret(keyId!), enabled: !!keyId });
  return { cfg, ready: !!providers && speechReady(cfg, providers, !!key.data) };
}
