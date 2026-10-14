import { useEffect, useReducer, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mic, RotateCw, Square } from "lucide-react";
import { pasteImporter } from "../../lib/importers/files";
import { SEGMENT_MS, TranscriptQueue, clock } from "../../lib/lecture/capture";
import { qk, useProviders, useSettings } from "../../lib/queries";
import { s } from "../../lib/strings";
import { DATE_SHORT, TIME_SHORT, formatDate, formatTime } from "../../lib/i18n/format";
import { AUDIO_FORMATS, speechSettings, transcribe } from "../../lib/tts/speech";
import type { Space } from "../../lib/types";
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/input";
import { Spinner } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { useImportFooter } from "./ImportDialog";

const formatOf = (mime: string): (typeof AUDIO_FORMATS)[number] =>
  mime.includes("mp4") || mime.includes("aac") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";

/** Shown only when transcription is available (an OpenRouter provider and MediaRecorder). */
const lectureTitle = () => {
  const d = new Date();
  return s.lecture.defaultTitle(formatDate(d, DATE_SHORT), formatTime(d, TIME_SHORT));
};

export function useLectureAvailable() {
  const { data: providers } = useProviders();
  return !!providers?.some((p) => p.type === "openrouter") && typeof MediaRecorder !== "undefined";
}

export function LectureTab({
  space,
  done,
  active,
  setHold,
}: {
  space: Space;
  done: () => void;
  active: boolean;
  setHold: (hold: boolean) => void;
}) {
  const qc = useQueryClient();
  const { data: providers } = useProviders();
  const { data: settings } = useSettings();
  const [, render] = useReducer((n: number) => n + 1, 0);
  const [title, setTitle] = useState(() => lectureTitle());
  const [recording, setRecording] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const live = useRef(false);
  const gen = useRef(0);
  const elapsed = useRef(0);
  const cfg = useRef({ settings, providers });
  cfg.current = { settings, providers };
  const queue = useRef<TranscriptQueue | null>(null);
  queue.current ??= new TranscriptQueue(
    async (blob, mime) =>
      transcribe(speechSettings(cfg.current.settings), new Uint8Array(await blob.arrayBuffer()), formatOf(mime), undefined, cfg.current.providers),
    render,
  );
  const q = queue.current;

  const release = () => {
    live.current = false;
    gen.current++;
    clearTimeout(timer.current);
    if (rec.current?.state === "recording") rec.current.stop();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  const starting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      release();
    };
  }, []);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [recording]);

  const fail = (e: unknown) => {
    release();
    setRecording(false);
    toastError(s.lecture.recorderFailed, e);
  };

  const segment = (t0: number, st: MediaStream, g: number) => {
    let r: MediaRecorder;
    try {
      r = new MediaRecorder(st);
    } catch (e) {
      fail(e);
      return;
    }
    const parts: Blob[] = [];
    const start = Date.now() - t0;
    r.ondataavailable = (e) => e.data.size && parts.push(e.data);
    r.onerror = (e) => g === gen.current && fail((e as unknown as { error?: unknown }).error ?? e);
    r.onstop = () => {
      q.add(new Blob(parts, { type: r.mimeType }), r.mimeType, start);
      if (live.current && g === gen.current) segment(t0, st, g);
      else if (st !== stream.current || !live.current) {
        st.getTracks().forEach((t) => t.stop());
        if (st === stream.current) stream.current = null;
      }
    };
    rec.current = r;
    try {
      r.start();
    } catch (e) {
      fail(e);
      return;
    }
    timer.current = setTimeout(() => r.state === "recording" && r.stop(), SEGMENT_MS);
  };

  const start = async () => {
    if (starting.current || live.current) return;
    starting.current = true;
    let st: MediaStream;
    try {
      st = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      toastError(s.speech.dictate.noMic, e);
      return;
    } finally {
      starting.current = false;
    }
    if (!mounted.current) {
      st.getTracks().forEach((t) => t.stop());
      return;
    }
    stream.current = st;
    const g = ++gen.current;
    const t0 = Date.now() - elapsed.current;
    live.current = true;
    setStartedAt(t0);
    setNow(Date.now());
    setRecording(true);
    segment(t0, st, g);
  };

  const stop = () => {
    live.current = false;
    gen.current++;
    elapsed.current = Date.now() - startedAt;
    clearTimeout(timer.current);
    if (rec.current?.state === "recording") rec.current.stop();
    setRecording(false);
  };

  const text = q.text;
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(false), [text]);
  const hold = recording || q.pending || (!!text && !saved);
  useEffect(() => setHold(hold), [hold, setHold]);
  useEffect(() => () => setHold(false), [setHold]);
  const save = async () => {
    setBusy(true);
    try {
      const src = await pasteImporter.import(space.id, { title: title.trim() || lectureTitle(), text });
      qc.invalidateQueries({ queryKey: qk.sources(space.id) });
      toast.success(s.sources.imported(src.title));
      setSaved(true);
      setHold(false);
      done();
    } catch (e) {
      toastError(s.sources.importFailed, e, save);
    } finally {
      setBusy(false);
    }
  };

  const status = recording ? s.lecture.recording(clock(now - startedAt)) : q.pending ? s.lecture.transcribing : undefined;
  useImportFooter(
    active
      ? {
          label: q.failed ? s.lecture.saveWithoutFailed(q.failed) : s.lecture.save,
          disabled: recording || q.pending || !text,
          busy,
          status,
          run: save,
        }
      : null,
  );

  return (
    <div data-testid="lecture-tab" data-state={recording ? "recording" : q.pending ? "transcribing" : "idle"} className="flex flex-col gap-3">
      <p className="text-label text-muted">{s.lecture.intro}</p>
      <div>
        <Label htmlFor="lecture-title">{s.sources.pasteTitle}</Label>
        <Input id="lecture-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex items-center gap-2">
        {recording ? (
          <Button variant="danger" onClick={stop} data-testid="lecture-stop">
            <Square size={12} fill="currentColor" />
            {s.lecture.stop}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => void start()} data-testid="lecture-start">
            <Mic size={15} />
            {q.segments.length ? s.lecture.resume : s.lecture.start}
          </Button>
        )}
        {recording && <span className="text-label tabular-nums text-muted">{clock(now - startedAt)}</span>}
      </div>
      {q.segments.length > 0 && (
        <div data-testid="lecture-transcript" className="flex max-h-60 flex-col gap-2 overflow-y-auto rounded-control border border-border p-3 text-body">
          {q.segments.map((seg) => (
            <div key={seg.index} className="flex gap-2" data-state={seg.state}>
              <span className="w-12 shrink-0 text-label tabular-nums text-muted">{clock(seg.start)}</span>
              {seg.state === "pending" && (
                <span className="flex items-center gap-1.5 text-muted">
                  <Spinner size={12} />
                  {s.lecture.transcribing}
                </span>
              )}
              {seg.state === "done" && <span className={seg.text ? "" : "text-muted"}>{seg.text || s.lecture.silence}</span>}
              {seg.state === "error" && (
                <span className="flex items-center gap-2 text-danger">
                  {s.lecture.failed}
                  <Button size="sm" variant="ghost" onClick={() => q.retry(seg.index)}>
                    <RotateCw size={12} />
                    {s.common.retry}
                  </Button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

