import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/ipc";
import { PodcastError, episodeText, pickTranscript, type Feed } from "../../lib/importers/podcast";
import { qk, useProviders, useSettings } from "../../lib/queries";
import { s } from "../../lib/strings";
import { speechSettings, transcribe } from "../../lib/tts/speech";
import type { Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { toast, toastError } from "../../components/ui/toast";
import { useImportFooter } from "./ImportDialog";

const SHOWN = 30;

/** Episode list for a podcast feed pasted into the Web page tab. */
export function PodcastPicker({ space, feed, done }: { space: Space; feed: Feed; done: () => void }) {
  const qc = useQueryClient();
  const { data: providers } = useProviders();
  const { data: settings } = useSettings();
  const canTranscribe = !!providers?.some((p) => p.type === "openrouter");
  const episodes = feed.episodes.slice(0, SHOWN);
  const [picked, setPicked] = useState(episodes[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const ep = episodes.find((e) => e.id === picked);
  const needsAudio = !!ep && !pickTranscript(ep);

  const run = async () => {
    if (!ep) return;
    setBusy(true);
    try {
      const { text } = await episodeText(ep, {
        getText: async (url) => {
          const page = await api.httpGetText(url);
          if (page.status >= 400) throw new Error(s.failures.http(page.status));
          return page.body;
        },
        getBytes: (url) => api.httpBytes({ id: crypto.randomUUID(), url, method: "GET", headers: {} }),
        transcribe: (audio, format) => transcribe(speechSettings(settings), audio, format, undefined, providers),
        onProgress: (d, t) => setProgress([d, t]),
      });
      if (!text.trim()) throw new Error(s.podcast.empty);
      const src = await api.importText(space.id, `${feed.title}: ${ep.title}`, text, "url", ep.link ?? ep.audioUrl);
      qc.invalidateQueries({ queryKey: qk.sources(space.id) });
      toast.success(s.sources.imported(src.title));
      done();
    } catch (e) {
      const msg = e instanceof PodcastError ? s.podcast.errors[e.message as keyof typeof s.podcast.errors] : undefined;
      toastError(s.sources.importFailed, msg ? new Error(msg) : e, run);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  useImportFooter({
    label: s.podcast.import,
    disabled: !ep || (needsAudio && !canTranscribe),
    busy,
    status: progress && progress[1] > 0 ? s.podcast.progress(Math.min(progress[0] + 1, progress[1]), progress[1]) : undefined,
    run,
  });

  return (
    <div data-testid="podcast-picker" className="flex flex-col gap-2">
      <p className="text-label text-muted">{s.podcast.found(feed.title, feed.episodes.length)}</p>
      <ul role="radiogroup" aria-label={s.podcast.episodes} className="flex max-h-72 flex-col overflow-y-auto rounded-control border border-border p-1">
        {episodes.map((e) => {
          const meta = [
            e.date ? new Date(e.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null,
            e.durationSec ? s.podcast.minutes(Math.max(1, Math.round(e.durationSec / 60))) : null,
            pickTranscript(e) ? s.podcast.hasTranscript : null,
          ].filter(Boolean);
          return (
            <li key={e.id}>
              <button
                type="button"
                role="radio"
                aria-checked={picked === e.id}
                onClick={() => setPicked(e.id)}
                className={cn("flex w-full flex-col items-start gap-0.5 rounded-item px-2.5 py-1.5 text-start hover:bg-fill", picked === e.id && "bg-fill-active")}
              >
                <span className="line-clamp-1 font-medium">{e.title}</span>
                {meta.length > 0 && <span className="text-label text-muted">{meta.join(" · ")}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {needsAudio && <p className="text-label text-muted">{canTranscribe ? s.podcast.willTranscribe : s.podcast.needsOpenRouter}</p>}
    </div>
  );
}
