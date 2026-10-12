import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { GeneratingStatus } from "../../components/brand/GeneratingStatus";
import { Button } from "../../components/ui/button";
import { Segmented } from "../../components/ui/misc";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { api } from "../../lib/ipc";
import { textHash } from "../../lib/notes/glossary";
import {
  LANGUAGES,
  langKind,
  levelKind,
  levelPrompt,
  rewritePassage,
  splitPassages,
  translatePrompt,
  type Passage,
  type ReadingLevel,
} from "../../lib/notes/passages";
import { s } from "../../lib/strings";
import type { PassageRewrite, Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { NativeSelect } from "../settings/NativeSelect";

const LEVELS: ReadingLevel[] = ["simpler", "original", "advanced"];

export function ReadingControls({
  level,
  lang,
  onLevel,
  onLang,
}: {
  level: ReadingLevel;
  lang: string | null;
  onLevel: (l: ReadingLevel) => void;
  onLang: (l: string | null) => void;
}) {
  return (
    <div role="group" aria-label={s.readingTools.group} className="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="reading-tools">
      <Segmented<ReadingLevel>
        label={s.readingTools.level}
        size="sm"
        value={level}
        onChange={onLevel}
        options={LEVELS.map((l) => ({ value: l, label: s.readingTools.levels[l] }))}
      />
      <label className="flex items-center gap-2 text-label font-semibold text-muted">
        {s.readingTools.translate}
        <NativeSelect
          className="w-[150px]"
          value={lang ?? ""}
          data-testid="translate-select"
          aria-label={s.readingTools.translate}
          onChange={(e) => onLang(e.target.value || null)}
        >
          <option value="">{s.readingTools.translateOff}</option>
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </label>
    </div>
  );
}

const inflight = new Map<string, Promise<PassageRewrite>>();
let running = 0;
const waiting: (() => void)[] = [];
const MAX_PARALLEL = 2;

async function limited<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  running++;
  try {
    return await job();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

export function PassageList({
  sourceId,
  text,
  space,
  level,
  lang,
}: {
  sourceId: string;
  text: string;
  space: Pick<Space, "modelOverride"> | undefined;
  level: ReadingLevel;
  lang: string | null;
}) {
  const passages = useMemo(() => splitPassages(text), [text]);
  return (
    <div className="flex flex-col gap-5" data-testid="passages" data-level={level} data-lang={lang ?? ""}>
      {level !== "original" && <p className="text-label text-muted">{s.readingTools.levelBanner}</p>}
      {lang && (
        <div className="grid grid-cols-2 gap-8 text-label font-semibold text-muted">
          <span>{s.readingTools.levels.original}</span>
          <span>{lang}</span>
        </div>
      )}
      {passages.map((p) => (
        <div key={p.start} className={cn(lang && "grid grid-cols-2 gap-8")} data-testid="passage">
          <div className="whitespace-pre-wrap break-words" data-testid="passage-main">
            {level === "original" ? (
              p.text
            ) : (
              <RewrittenPassage
                sourceId={sourceId}
                space={space}
                kind={levelKind(level)}
                passage={p}
                prompt={levelPrompt(level, p.text)}
                working={s.readingTools.working}
                failed={s.readingTools.failed}
              />
            )}
          </div>
          {lang && (
            <div className="whitespace-pre-wrap break-words" data-testid="passage-translation">
              <RewrittenPassage
                sourceId={sourceId}
                space={space}
                kind={langKind(lang)}
                passage={p}
                prompt={translatePrompt(lang, p.text)}
                working={s.readingTools.translating}
                failed={s.readingTools.translateFailed}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** One passage rewritten by the model; fetched the first time it scrolls into view, then read from the database. */
function RewrittenPassage({
  sourceId,
  space,
  kind,
  passage,
  prompt,
  working,
  failed,
}: {
  sourceId: string;
  space: Pick<Space, "modelOverride"> | undefined;
  kind: string;
  passage: Passage;
  prompt: string;
  working: string;
  failed: string;
}) {
  const qc = useQueryClient();
  const key = ["rewrites", sourceId, kind] as const;
  const cached = useQuery({ queryKey: key, queryFn: () => api.rewritesList(sourceId, kind) });
  const hash = textHash(passage.text);
  const hit = cached.data?.find((r) => r.start === passage.start && r.end === passage.end && r.textHash === hash);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === "undefined") return setVisible(true);
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setVisible(true), { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || hit || !cached.isSuccess) return;
    const id = `${sourceId}|${kind}|${passage.start}|${passage.end}|${hash}`;
    let job = inflight.get(id);
    if (!job) {
      job = limited(async () => {
        const llm = await resolveChatModel(space);
        const out = await rewritePassage(llm, prompt);
        const rewrite: PassageRewrite = { sourceId, kind, start: passage.start, end: passage.end, textHash: hash, text: out };
        await api.rewriteSave(rewrite);
        return rewrite;
      });
      inflight.set(id, job);
      const clear = () => inflight.delete(id);
      job.then(clear, clear);
    }
    let alive = true;
    setError(null);
    job.then(
      (r) => {
        qc.setQueryData<PassageRewrite[]>(key, (cur) => [...(cur ?? []).filter((x) => !(x.start === r.start && x.end === r.end)), r]);
      },
      (e) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, hit, cached.isSuccess, attempt]);

  if (hit) return <>{hit.text}</>;
  const err = error ?? cached.error;
  return (
    <div ref={box}>
      {err ? (
        <div role="alert" className="flex flex-col items-start gap-1.5 text-body">
          <span className="text-danger">{cached.error ? s.readingTools.loadFailed : failed}</span>
          <span className="text-label text-muted">{err instanceof NoModelError ? s.chat.noModel : err instanceof Error ? err.message : String(err)}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setError(null);
              if (cached.error) void cached.refetch();
              else setAttempt((a) => a + 1);
            }}
          >
            {s.common.retry}
          </Button>
        </div>
      ) : (
        <GeneratingStatus label={working} className="text-muted" />
      )}
    </div>
  );
}
