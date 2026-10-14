import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Cloud, Folder, LogIn, Search, Settings } from "lucide-react";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { CloudItem, CloudService, Space } from "../../lib/types";
import { backTo, dropboxTrail, enterFolder, formatSize, importCloudItems, typeLabel, type Crumb } from "../../lib/importers/cloud";
import { useUi } from "../../stores/ui";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Checkbox16 } from "../../components/ui/checkbox";
import { EmptyState, ErrorState, Skeleton, Spinner } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { ck, useCloudStatus } from "../settings/cloudQueries";
import { useImportFooter } from "./ImportDialog";

export function CloudTab({ service, space, done }: { service: CloudService; space: Space; done: () => void }) {
  const qc = useQueryClient();
  const status = useCloudStatus(service);
  const navigate = useUi((st) => st.navigate);
  const setImportDialog = useUi((st) => st.setImportDialog);
  const name = s.cloud.names[service];
  const st = status.data;

  const connect = useMutation({
    mutationFn: () => api.cloudConnect(service),
    onSuccess: () => st && qc.setQueryData(ck.status(service), { ...st, state: "pending", error: null }),
    onError: (e) => toastError(s.cloud.connectFailed, e),
  });

  if (status.isLoading) return <Skeleton className="h-64" />;
  if (status.error || !st) return <ErrorState title={s.errors.generic} error={status.error} onRetry={() => status.refetch()} />;

  if (!st.configured) {
    return (
      <EmptyState
        icon={<Cloud size={22} />}
        title={s.cloud.needsClient[service]}
        body={s.cloud.sectionBody}
        action={
          <Button
            variant="primary"
            onClick={() => {
              setImportDialog({ open: false });
              navigate({ name: "settings", section: "cloud" });
            }}
          >
            <Settings size={15} aria-hidden /> {s.cloud.openSettings}
          </Button>
        }
      />
    );
  }

  if (st.state !== "signedIn") {
    const pending = st.state === "pending";
    return (
      <EmptyState
        icon={<Cloud size={22} />}
        title={s.cloud.needsConnect(name)}
        body={pending ? s.cloud.browserHint : st.state === "error" ? <span className="text-danger">{st.error}</span> : undefined}
        action={
          <Button variant="primary" onClick={() => connect.mutate()} disabled={pending || connect.isPending}>
            {pending ? <Spinner size={15} className="text-on-primary" /> : <LogIn size={15} aria-hidden />}
            {st.state === "error" ? s.cloud.reconnect : s.cloud.connect}
          </Button>
        }
      />
    );
  }

  return <CloudBrowser service={service} space={space} done={done} />;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function formatModified(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric", month: "short", day: "numeric" });
}

function CloudBrowser({ service, space, done }: { service: CloudService; space: Space; done: () => void }) {
  const qc = useQueryClient();
  const root: Crumb = { id: null, name: s.cloud.rootNames[service] };
  const [trail, setTrail] = useState<Crumb[]>([root]);
  const [search, setSearch] = useState("");
  const query = useDebounced(search.trim(), 300);
  const [selected, setSelected] = useState<Map<string, CloudItem>>(new Map());
  const folder = trail[trail.length - 1].id;
  const dir = useRef(1);

  const list = useInfiniteQuery({
    queryKey: ck.list(service, folder, query),
    queryFn: ({ pageParam }) => api.cloudList(service, folder, query || null, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
  });
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);

  const open = (item: CloudItem) => {
    dir.current = 1;
    setSearch("");
    setTrail((t) => (query ? (service === "dropbox" ? dropboxTrail(item.id, root.name) : enterFolder([root], item)) : enterFolder(t, item)));
  };
  const toggle = (item: CloudItem) =>
    setSelected((cur) => {
      const next = new Map(cur);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });

  const importSel = useMutation({
    mutationFn: () => importCloudItems(service, space.id, [...selected.values()]),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: qk.sources(space.id) });
      qc.invalidateQueries({ queryKey: qk.spaces });
      if (res.sources.length) toast.success(s.cloud.importedN(res.sources.length));
      if (res.failures.length) {
        toastError(s.sources.importFailed, new Error(res.failures.map((f) => `${f.name}: ${f.error}`).join("\n")));
        const failed = new Set(res.failures.map((f) => f.name));
        setSelected(new Map([...selected].filter(([, i]) => failed.has(i.name))));
      }
      if (res.sources.length && !res.failures.length) done();
    },
    onError: (e) => toastError(s.sources.importFailed, e, () => importSel.mutate()),
  });

  useImportFooter({
    label: s.cloud.importN(selected.size),
    disabled: !selected.size,
    busy: importSel.isPending,
    status: selected.size ? s.cloud.selected(selected.size) : s.cloud.supportedHint,
    run: () => importSel.mutate(),
  });

  return (
    <div className="flex flex-col gap-3.5" data-testid={`cloud-browser-${service}`}>
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label={s.cloud.pathLabel} className="flex min-w-0 flex-1 items-center gap-2 text-body">
          {query ? (
            <span className="truncate font-medium">{s.cloud.search(s.cloud.names[service])}</span>
          ) : (
            trail.map((c, i) => (
              <span key={`${c.id}-${i}`} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <span className="text-faint" aria-hidden>/</span>}
                <button
                  type="button"
                  onClick={() => {
                    dir.current = -1;
                    setTrail(backTo(trail, i));
                  }}
                  aria-current={i === trail.length - 1 ? "page" : undefined}
                  className={cn("truncate font-medium hover:text-fg", i === trail.length - 1 ? "text-fg" : "text-fg-secondary")}
                >
                  {c.name}
                </button>
              </span>
            ))
          )}
        </nav>
        <div className="relative w-60">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={s.cloud.search(s.cloud.names[service])}
            aria-label={s.cloud.search(s.cloud.names[service])}
            className="ps-3 pe-8 text-input"
          />
          <Search size={14} className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
        </div>
      </div>

      <div className="overflow-hidden rounded-card border border-border">
        <div className={cn(GRID, "h-[34px] bg-fill-faint text-label font-semibold text-muted")}>
          <span />
          <span>{s.cloud.columns.name}</span>
          <span>{s.cloud.columns.type}</span>
          <span>{s.cloud.columns.size}</span>
          <span>{s.cloud.columns.modified}</span>
        </div>
        <div className="max-h-[320px] min-h-[120px] overflow-y-auto" role="list" aria-label={s.cloud.names[service]}>
          <div key={folder ?? "root"} className="t-page-enter" style={{ "--t-page-dir": dir.current } as CSSProperties}>
          {list.isLoading && (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-7" />
              ))}
            </div>
          )}
          {list.error && <ErrorState title={s.cloud.listFailed} error={list.error} onRetry={() => list.refetch()} />}
          {list.isSuccess && items.length === 0 && (
            <EmptyState icon={<Folder size={20} />} title={query ? s.cloud.noResults : s.cloud.emptyFolder} className="py-8" />
          )}
          {items.map((item) => (
            <Row key={item.id} item={item} checked={selected.has(item.id)} onOpen={() => open(item)} onToggle={() => toggle(item)} />
          ))}
          {list.hasNextPage && (
            <div className="flex justify-center border-t border-divider p-2">
              <Button size="sm" variant="ghost" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage && <Spinner size={14} />} {s.cloud.loadMore}
              </Button>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

const GRID = "grid grid-cols-[28px_minmax(0,1fr)_90px_70px_90px] items-center gap-2 px-3";

function Row({ item, checked, onOpen, onToggle }: { item: CloudItem; checked: boolean; onOpen: () => void; onToggle: () => void }) {
  const ok = item.folder || item.supported;
  const cells = (
    <>
      <span className="truncate">{typeLabel(item)}</span>
      <span className="tabular-nums">{item.folder ? "—" : formatSize(item.size)}</span>
      <span className="truncate">{formatModified(item.modified)}</span>
    </>
  );
  const base = cn(GRID, "h-[41px] border-t border-divider text-body", ok ? "text-fg" : "text-faint");
  if (item.folder) {
    return (
      <div role="listitem" className={cn(base, "hover:bg-fill-faint")}>
        <span />
        <button type="button" onClick={onOpen} className="truncate text-start font-medium">
          {item.name}
        </button>
        {cells}
      </div>
    );
  }
  return (
    <label
      role="listitem"
      title={item.supported ? undefined : s.cloud.unsupported}
      className={cn(base, item.supported && "cursor-pointer hover:bg-fill-faint")}
    >
      {item.supported ? (
        <Checkbox16 checked={checked} onChange={onToggle} aria-label={s.cloud.selectItem(item.name)} />
      ) : (
        <span />
      )}
      <span className="truncate font-medium">{item.supported ? item.name : `${item.name} · ${s.cloud.unsupported}`}</span>
      {cells}
    </label>
  );
}
