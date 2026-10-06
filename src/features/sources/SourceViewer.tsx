import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BookOpenCheck, ExternalLink } from "lucide-react";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import { buildPieces } from "../../lib/sources/pieces";
import { useUi } from "../../stores/ui";
import { ErrorState, Skeleton, Tooltip } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { detectChapters } from "../../lib/placement/logic";
import type { Source } from "../../lib/types";
import { KIND_ICON } from "./SourcesPane";

export function SourceViewer({ target }: { target: { sourceId: string; start?: number; end?: number } }) {
  const openViewer = useUi((st) => st.openViewer);
  const source = useQuery({ queryKey: ["source", target.sourceId], queryFn: () => api.getSource(target.sourceId) });
  const text = useQuery({ queryKey: qk.sourceText(target.sourceId), queryFn: () => api.getSourceText(target.sourceId) });
  const markRef = useRef<HTMLElement>(null);

  const pieces = useMemo(() => (text.data ? buildPieces(text.data, target.start, target.end) : []), [text.data, target.start, target.end]);

  useEffect(() => {
    if (markRef.current) markRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [pieces]);

  const Icon = source.data ? KIND_ICON[source.data.kind] : null;
  let firstMark = true;

  return (
    <div className="flex h-full flex-col" data-testid="source-viewer">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <button
          aria-label={s.common.back}
          onClick={() => openViewer(null)}
          className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
        >
          <ArrowLeft size={17} />
        </button>
        {Icon && <Icon size={16} className="shrink-0 text-muted" />}
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{source.data?.title ?? s.sources.viewerLoading}</p>
        {source.data && text.data && <MakeCourseButton source={source.data} text={text.data.text} />}
        {source.data?.origin && /^https?:/.test(source.data.origin) && (
          <a
            href={source.data.origin}
            target="_blank"
            rel="noreferrer"
            aria-label="Open original"
            className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
          >
            <ExternalLink size={15} />
          </a>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {(source.isLoading || text.isLoading) && (
          <div className="space-y-3 p-5">
            <Skeleton className="h-16" />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-4" />
            ))}
          </div>
        )}
        {(source.error || text.error) && (
          <ErrorState
            title="Couldn't open this source"
            error={source.error ?? text.error}
            onRetry={() => {
              source.refetch();
              text.refetch();
            }}
          />
        )}
        {source.data && text.data && (
          <div className="px-5 py-4">
            <div className="mb-5 rounded-2xl bg-surface-2 px-4 py-3">
              <p className="text-xs font-medium text-muted">{s.sources.summary}</p>
              <p className="mt-1 text-[0.8125rem] leading-relaxed">{source.data.summary ?? s.sources.noSummary}</p>
            </div>
            <div className="whitespace-pre-wrap break-words text-[0.875rem] leading-[1.75]" data-testid="source-text">
              {pieces.map((p, i) => (
                <span key={i}>
                  {p.page != null && (
                    <span className="my-3 block select-none border-t border-border pt-2 text-[0.6875rem] font-medium text-faint">
                      {s.sources.page(p.page)}
                    </span>
                  )}
                  {p.mark ? (
                    <mark
                      className="cite-highlight"
                      data-testid="cite-highlight"
                      ref={(() => {
                        const isFirst = firstMark;
                        firstMark = false;
                        return isFirst ? markRef : undefined;
                      })()}
                    >
                      {p.text}
                    </mark>
                  ) : (
                    p.text
                  )}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MakeCourseButton({ source, text }: { source: Source; text: string }) {
  const qc = useQueryClient();
  const chapters = useMemo(() => detectChapters(text), [text]);
  if (chapters.length < 2) return null;
  const make = async () => {
    try {
      const course = await api.courseCreate(
        source.spaceId,
        source.id,
        source.title,
        chapters.map((c) => ({ title: c.title, startOffset: c.start, endOffset: c.end })),
      );
      qc.invalidateQueries({ queryKey: qk.courses(source.spaceId) });
      toast.success(s.course.created(course.lessons.length));
    } catch (e) {
      toastError(s.errors.generic, e, make);
    }
  };
  return (
    <Tooltip content={s.course.makeHelp}>
      <button onClick={make} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-accent-text hover:bg-accent-soft">
        <BookOpenCheck size={14} /> {s.course.make}
      </button>
    </Tooltip>
  );
}
