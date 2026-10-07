import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { ProviderIcon } from "../../components/ProviderIcon";
import { Skeleton } from "../../components/ui/misc";
import { modelLabel } from "../../lib/providers/controls";
import {
  OPENROUTER_AUTHORS,
  SEARCH_LIMIT,
  authorOf,
  recommendedModels,
  searchModels,
} from "../../lib/providers/openrouter";
import { useOpenRouterModels } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { OpenRouterModel, Provider } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";

export const PLAIN_SEARCH_THRESHOLD = 8;

const scrollClass = "min-h-[72px] flex-1 overflow-y-auto";
const wrapClass = "flex min-h-0 flex-1 flex-col";
const rowClass = "flex h-[34px] w-full items-center gap-2.5 rounded-item px-2.5 text-left outline-none hover:bg-fill focus-visible:bg-fill";

export const providerModels = (p: Provider) =>
  (p.config.models ?? (p.config.defaultModel ? [p.config.defaultModel] : [])).filter((m) => !/embed/i.test(m));

function Row({ id, on, author, onPick }: { id: string; on: boolean; author?: string; onPick: (id: string) => void }) {
  return (
    <button
      role="menuitemradio"
      aria-checked={on}
      data-nav
      title={id}
      onClick={() => onPick(id)}
      className={cn(rowClass, on && "bg-fill-active")}
    >
      {author !== undefined && <ProviderIcon author={author} size={16} />}
      <span className={cn("min-w-0 flex-1 truncate", on ? "font-semibold" : "font-medium")}>{modelLabel(id)}</span>
      {on && <Check size={14} className="shrink-0" />}
    </button>
  );
}

const Heading = ({ children }: { children: string }) => (
  <p className="pb-1 pl-3 pr-2.5 pt-2 text-label font-semibold text-muted">{children}</p>
);

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="mx-1.5 mb-1 mt-0.5 flex h-[30px] items-center gap-2 rounded-btn border border-border px-2.5 text-muted">
      <Search size={13} />
      <input
        data-nav
        data-model-search
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-faint"
      />
    </label>
  );
}

function PlainList({ provider, selected, onPick }: { provider: Provider; selected: string | null; onPick: (m: string) => void }) {
  const [query, setQuery] = useState("");
  const all = providerModels(provider);
  const q = query.trim().toLowerCase();
  const models = all.filter((m) => !q || m.toLowerCase().includes(q));
  return (
    <div data-list className={wrapClass}>
      {all.length > PLAIN_SEARCH_THRESHOLD && <SearchBox value={query} onChange={setQuery} label={s.models.search(all.length)} />}
      <div className={scrollClass}>
        {models.map((m) => (
          <Row key={m} id={m} on={m === selected} onPick={onPick} />
        ))}
        {models.length === 0 && <p className="px-3 py-3 text-muted">{all.length ? s.models.noResults : s.models.noModels}</p>}
      </div>
    </div>
  );
}

function OpenRouterList({ provider, selected, onPick }: { provider: Provider; selected: string | null; onPick: (m: string) => void }) {
  const catalog = useOpenRouterModels(true);
  const recent = useUi((st) => st.recentModels[provider.id]);
  const [query, setQuery] = useState("");
  const [author, setAuthor] = useState<string | null>(null);

  const list: OpenRouterModel[] | null = useMemo(() => {
    if (catalog.data) return catalog.data;
    if (catalog.isError)
      return providerModels(provider).map((id) => ({ id, name: id, contextLength: null, supportedParameters: [], created: null }));
    return null;
  }, [catalog.data, catalog.isError, provider]);

  const searching = query.trim() !== "" || author !== null;
  const results = useMemo(() => (list && searching ? searchModels(list, query, author) : []), [list, searching, query, author]);

  const recents = useMemo(() => {
    const ids = [...(recent ?? [])];
    if (selected && !ids.includes(selected)) ids.unshift(selected);
    const fallback = provider.config.defaultModel;
    if (!ids.length && fallback) ids.push(fallback);
    return ids.slice(0, 8);
  }, [recent, selected, provider.config.defaultModel]);
  const recommended = useMemo(
    () => (list ? recommendedModels(list).filter((m) => !recents.includes(m.id)) : []),
    [list, recents],
  );

  return (
    <div data-list className={wrapClass}>
      <SearchBox value={query} onChange={setQuery} label={s.models.searchOpenRouter} />
      <div role="group" aria-label={s.models.filterByAuthor} className="mx-1.5 mb-1 flex gap-0.5">
        <button
          data-author="all"
          aria-pressed={author === null}
          onClick={() => setAuthor(null)}
          className={cn(
            "h-7 rounded-btn px-2 text-label hover:bg-fill",
            author === null ? "bg-fill-active font-semibold text-fg" : "font-medium text-muted",
          )}
        >
          {s.models.allAuthors}
        </button>
        {OPENROUTER_AUTHORS.map((a) => (
          <button
            key={a.id}
            data-author={a.id}
            aria-pressed={author === a.id}
            aria-label={a.label}
            title={a.label}
            onClick={() => setAuthor(author === a.id ? null : a.id)}
            className={cn("flex size-7 items-center justify-center rounded-btn hover:bg-fill", author === a.id ? "bg-fill-active" : "opacity-70 hover:opacity-100")}
          >
            <ProviderIcon author={a.id} size={16} />
          </button>
        ))}
      </div>

      {catalog.isLoading && !list && (
        <div className="space-y-1.5 px-2.5 py-2" aria-busy>
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-5 w-3/5" />
        </div>
      )}
      {catalog.isError && (
        <p className="flex items-center gap-2 px-3 py-1.5 text-label text-muted">
          <span className="flex-1">{s.models.listFailed}</span>
          <button className="font-semibold text-fg underline-offset-2 hover:underline" onClick={() => catalog.refetch()}>
            {s.models.retry}
          </button>
        </p>
      )}

      <div className={scrollClass}>
      {list && !searching && (
        <>
          {recents.length > 0 && <Heading>{s.models.recent}</Heading>}
          {recents.map((id) => (
            <Row key={id} id={id} author={authorOf(id)} on={id === selected} onPick={onPick} />
          ))}
          {recommended.length > 0 && <Heading>{s.models.recommended}</Heading>}
          {recommended.map((m) => (
            <Row key={m.id} id={m.id} author={authorOf(m.id)} on={m.id === selected} onPick={onPick} />
          ))}
        </>
      )}
      {list && searching && (
        <>
          <Heading>{s.models.results}</Heading>
          {results.slice(0, SEARCH_LIMIT).map((m) => (
            <Row key={m.id} id={m.id} author={authorOf(m.id)} on={m.id === selected} onPick={onPick} />
          ))}
          {results.length === 0 && <p className="px-3 py-3 text-muted">{s.models.noResults}</p>}
          {results.length > SEARCH_LIMIT && <p className="px-3 pb-2 pt-1 text-label text-muted">{s.models.topResults(SEARCH_LIMIT)}</p>}
        </>
      )}
      </div>
    </div>
  );
}

/** Models of one provider. OpenRouter gets search, an author filter, recents and recommendations. */
export function ModelBrowser({ provider, selected, onPick }: { provider: Provider; selected: string | null; onPick: (m: string) => void }) {
  return provider.type === "openrouter" ? (
    <OpenRouterList key={provider.id} provider={provider} selected={selected} onPick={onPick} />
  ) : (
    <PlainList key={provider.id} provider={provider} selected={selected} onPick={onPick} />
  );
}
