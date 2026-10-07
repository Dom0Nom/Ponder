import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useUi } from "../../stores/ui";
import * as Tabs from "@radix-ui/react-tabs";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, Upload } from "lucide-react";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Space } from "../../lib/types";
import { Dialog } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Input, Label, Textarea } from "../../components/ui/input";
import { Spinner } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { fileImporter, pasteImporter, pickFiles } from "../../lib/importers/files";
import { normalizeUrl, webImporter } from "../../lib/importers/web";
import { isYouTubeUrl, youtubeImporter } from "../../lib/importers/youtube";
import { proxyHttp } from "../../lib/importers/http";
import { ResearchPanel } from "./ResearchPanel";
import { CloudTab } from "./CloudTab";

export interface ImportFooter {
  label: string;
  disabled?: boolean;
  busy?: boolean;
  status?: string;
  run: () => void;
}

const FooterCtx = createContext<(f: ImportFooter | null) => void>(() => {});

/** Registers the active tab's primary action in the dialog footer. */
export function useImportFooter(f: ImportFooter | null) {
  const set = useContext(FooterCtx);
  const run = useRef(f?.run);
  run.current = f?.run;
  const key = f ? `${f.label}|${!!f.disabled}|${!!f.busy}|${f.status ?? ""}` : "";
  useEffect(() => {
    set(f ? { ...f, run: () => run.current?.() } : null);
    return () => set(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, set]);
}

const WIDTH: Record<string, number> = { file: 522, paste: 522, url: 522, youtube: 522, research: 602, gdrive: 682, dropbox: 682 };

const TABS = [
  { id: "file", label: s.sources.tabs.file },
  { id: "paste", label: s.sources.tabs.paste },
  { id: "url", label: s.sources.tabs.url },
  { id: "youtube", label: s.sources.tabs.youtube },
  { id: "gdrive", label: s.sources.tabs.gdrive },
  { id: "dropbox", label: s.sources.tabs.dropbox },
  { id: "research", label: s.sources.tabs.research },
] as const;

export function ImportDialog({
  space,
  open,
  onOpenChange,
  initialTab,
}: {
  space: Space;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialTab?: string;
}) {
  const [tab, setTab] = useState(initialTab ?? "file");
  const [footer, setFooter] = useState<ImportFooter | null>(null);
  const query = useUi((st) => st.importDialog.query);
  const found = useUi((st) => st.importDialog.found);
  const setSourcesOpen = useUi((st) => st.setSourcesOpen);
  const done = () => {
    setSourcesOpen(space.id, true);
    onOpenChange(false);
  };
  useEffect(() => {
    if (open) setTab(initialTab ?? "file");
  }, [open, initialTab]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={s.sources.importTitle}
      className="max-h-[720px]"
      style={{ width: `min(${WIDTH[tab] ?? 520}px, calc(100vw - 32px))` }}
      footer={
        <>
          {footer?.status && <span className="mr-auto min-w-0 truncate text-muted">{footer.status}</span>}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {s.common.cancel}
          </Button>
          <Button variant="primary" disabled={!footer || footer.disabled || footer.busy} onClick={() => footer?.run()}>
            {footer?.busy && <Spinner size={15} className="text-on-primary" />}
            {footer?.busy ? s.sources.importing : (footer?.label ?? s.sources.import)}
          </Button>
        </>
      }
    >
      <FooterCtx.Provider value={setFooter}>
        <Tabs.Root value={tab} onValueChange={setTab} className="flex flex-col gap-3.5">
          <Tabs.List aria-label={s.sources.importTitle} className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <Tabs.Trigger
                key={t.id}
                value={t.id}
                className="inline-flex h-7 items-center rounded-btn px-2.5 font-medium text-fg hover:bg-fill data-[state=active]:bg-fill-active data-[state=active]:font-semibold"
              >
                {t.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value="file">
            <FileTab space={space} done={done} />
          </Tabs.Content>
          <Tabs.Content value="paste">
            <PasteTab space={space} done={done} />
          </Tabs.Content>
          <Tabs.Content value="url">
            <UrlTab space={space} kind="url" done={done} />
          </Tabs.Content>
          <Tabs.Content value="youtube">
            <UrlTab space={space} kind="youtube" done={done} />
          </Tabs.Content>
          <Tabs.Content value="gdrive">
            <CloudTab service="google" space={space} done={done} />
          </Tabs.Content>
          <Tabs.Content value="dropbox">
            <CloudTab service="dropbox" space={space} done={done} />
          </Tabs.Content>
          <Tabs.Content value="research">
            <ResearchPanel key={query ?? ""} space={space} initialQuery={query} initialFound={found} done={done} />
          </Tabs.Content>
        </Tabs.Root>
      </FooterCtx.Provider>
    </Dialog>
  );
}

function FileTab({ space, done }: { space: Space; done: () => void }) {
  const qc = useQueryClient();
  const [staged, setStaged] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const choose = async () => {
    try {
      const paths = await pickFiles();
      if (paths.length) setStaged((cur) => [...new Set([...cur, ...paths])]);
      return paths;
    } catch (e) {
      toastError(s.sources.importFailed, e, choose);
      return [];
    }
  };
  const importPaths = async (paths: string[]) => {
    setBusy(true);
    try {
      const failures: string[] = [];
      for (const p of paths) {
        try {
          await fileImporter.import(space.id, p);
        } catch (e) {
          failures.push(`${p.split(/[\\/]/).pop()}: ${(e as Error).message}`);
        }
      }
      qc.invalidateQueries({ queryKey: qk.sources(space.id) });
      if (failures.length) toastError(s.sources.importFailed, new Error(failures.join("\n")));
      if (failures.length < paths.length) {
        setStaged([]);
        done();
      }
    } finally {
      setBusy(false);
    }
  };
  const run = async () => importPaths(staged.length ? staged : await choose());
  useImportFooter({ label: s.sources.import, busy, status: staged.length ? s.sources.chosen(staged.length) : undefined, run });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col items-center gap-2.5 rounded-card border border-dashed border-control-off p-7 text-fg-secondary transition-colors duration-(--motion-quick)">
        <span className="flex h-[29px] items-center">
          <Upload size={20} />
        </span>
        <p>{s.sources.fileHelp}</p>
        <Button variant="secondary" onClick={choose}>
          {s.sources.chooseFiles}
        </Button>
      </div>
      {staged.length > 0 && (
        <ul className="flex flex-col gap-1.5" data-testid="staged-files">
          {staged.map((p) => (
            <li key={p} className="flex items-center gap-2 text-body">
              <FileText size={14} className="shrink-0 text-muted" />
              <span className="truncate">{p.split(/[\\/]/).pop()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PasteTab({ space, done }: { space: Space; done: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const src = await pasteImporter.import(space.id, { title, text });
      qc.invalidateQueries({ queryKey: qk.sources(space.id) });
      toast.success(s.sources.imported(src.title));
      setTitle("");
      setText("");
      done();
    } catch (e) {
      toastError(s.sources.importFailed, e, submit);
    } finally {
      setBusy(false);
    }
  };
  useImportFooter({ label: s.sources.import, disabled: !text.trim(), busy, run: submit });
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="paste-title">{s.sources.pasteTitle}</Label>
        <Input id="paste-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={s.sources.optional} />
      </div>
      <div>
        <Label htmlFor="paste-body">{s.sources.pasteBody}</Label>
        <Textarea id="paste-body" rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder={s.sources.pastePlaceholder} />
      </div>
    </div>
  );
}

function UrlTab({ space, kind, done }: { space: Space; kind: "url" | "youtube"; done: () => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = kind === "youtube" ? isYouTubeUrl(url) : !!normalizeUrl(url);
  const submit = async () => {
    setBusy(true);
    try {
      const importer = kind === "youtube" || isYouTubeUrl(url) ? youtubeImporter(proxyHttp) : webImporter;
      const src = await importer.import(space.id, url);
      qc.invalidateQueries({ queryKey: qk.sources(space.id) });
      toast.success(s.sources.imported(src.title));
      setUrl("");
      done();
    } catch (e) {
      toastError(s.sources.importFailed, e, submit);
    } finally {
      setBusy(false);
    }
  };
  useImportFooter({ label: s.sources.import, disabled: !valid, busy, run: submit });
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) submit();
      }}
    >
      <Label htmlFor={`url-${kind}`} className="mb-0">
        {kind === "youtube" ? s.sources.youtubeLabel : s.sources.urlLabel}
      </Label>
      <Input
        id={`url-${kind}`}
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={kind === "youtube" ? s.sources.youtubePlaceholder : s.sources.urlPlaceholder}
      />
      <p className="text-label text-muted">{kind === "youtube" ? s.sources.youtubeHint : s.sources.urlHint}</p>
      {url && !valid && <p className="text-label text-danger">{kind === "youtube" ? s.sources.badYoutube : s.sources.badUrl}</p>}
    </form>
  );
}
