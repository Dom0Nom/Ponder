import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ActivityOrb } from "../../components/motion/ActivityOrb";
import { SuccessCircleCheck } from "../../components/motion/SuccessCheck";
import { TextSwap } from "../../components/motion/TextSwap";
import { ErrorState } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { api, events } from "../../lib/ipc";
import { formatNumber } from "../../lib/i18n/format";
import { useLocale } from "../../lib/i18n/state";
import { qk, useSpaces } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { EmbedderStatus } from "../../lib/types";
import { Choice, Heading } from "./parts";

function Progress({ st }: { st: EmbedderStatus | null }) {
  const ob = s.onboarding.search;
  if (!st) return null;
  const busy = st.state === "downloading" || st.state === "loading" || st.state === "indexing";
  const label =
    st.state === "downloading"
      ? ob.downloading(st.progress)
      : st.state === "ready"
        ? ob.ready
        : st.state === "error"
          ? (st.error ?? ob.error)
          : ob.loading;
  return (
    <div data-testid="search-progress" className="flex flex-col gap-2 rounded-card border border-border p-4">
      <div className="flex items-center gap-3">
        {busy ? <ActivityOrb activity="plan" size={32} /> : st.state === "ready" ? <SuccessCircleCheck size={20} /> : null}
        <span role="status" className="flex-1 text-body font-medium">
          <TextSwap text={label} />
        </span>
      </div>
      {busy && (
        <div className="h-1 overflow-hidden rounded-full bg-fill-active" role="progressbar" aria-valuenow={Math.round(st.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="m-progress h-full rounded-full bg-primary" style={{ width: `${Math.round(st.progress * 100)}%` }} />
        </div>
      )}
      {busy && <p className="text-caption text-muted">{ob.backgroundNote}</p>}
    </div>
  );
}

export function SearchStep() {
  const locale = useLocale();
  const { data: spaces } = useSpaces();
  const models = useQuery({ queryKey: qk.embeddingModels, queryFn: api.embeddingModels, staleTime: Infinity });
  const [st, setSt] = useState<EmbedderStatus | null>(null);
  const applied = useRef(false);
  const ob = s.onboarding.search;

  const spaceLang = spaces?.find((x) => x.language)?.language;
  const wantMulti = (spaceLang ?? locale) !== "en" && !(spaceLang ?? locale).startsWith("en-");

  useEffect(() => {
    api.embedderStatus().then(setSt).catch(() => {});
    const un = events.embedderStatus(setSt);
    return () => {
      un.then((f) => f()).catch(() => {});
    };
  }, []);

  const choose = async (id: string) => {
    try {
      await api.setEmbeddingModel(id);
      setSt((prev) => (prev ? { ...prev, model: id } : prev));
    } catch (e) {
      toastError(s.errors.generic, e, () => void choose(id));
    }
  };

  const list = models.data ?? [];
  const suggested = list.find((m) => m.multilingual === wantMulti) ?? list[0];
  useEffect(() => {
    if (applied.current || !suggested || !st) return;
    applied.current = true;
    if (st.model !== suggested.id && !st.model.startsWith("openrouter:")) void choose(suggested.id);
  }, [suggested, st]);

  if (models.error) return <ErrorState size="sm" title={s.errors.generic} error={models.error} onRetry={() => models.refetch()} />;
  const current = st?.model;
  return (
    <>
      <Heading title={ob.title} body={ob.body} />
      <div role="radiogroup" aria-label={ob.title} className="flex flex-col gap-3">
        {list.map((m, i) => (
          <Choice
            key={m.id}
            index={i}
            selected={current === m.id}
            onSelect={() => void choose(m.id)}
            title={m.multilingual ? ob.multilingual : ob.english}
            body={`${m.multilingual ? ob.multilingualBody : ob.englishBody} ${ob.size(formatNumber(m.sizeMb))}`}
            badge={m.id === suggested?.id ? ob.suggested : undefined}
          />
        ))}
      </div>
      <Progress st={st} />
    </>
  );
}
