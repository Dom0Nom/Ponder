import { useEffect, useState } from "react";
import { useUi } from "../../stores/ui";
import * as Tabs from "@radix-ui/react-tabs";
import { useQueryClient } from "@tanstack/react-query";
import { Cloud, FileUp, Globe, HardDrive, Sparkles, StickyNote, SquarePlay } from "lucide-react";
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

const TABS = [
  { id: "file", label: s.sources.tabs.file, icon: FileUp },
  { id: "paste", label: s.sources.tabs.paste, icon: StickyNote },
  { id: "url", label: s.sources.tabs.url, icon: Globe },
  { id: "youtube", label: s.sources.tabs.youtube, icon: SquarePlay },
  { id: "gdrive", label: s.sources.tabs.gdrive, icon: HardDrive },
  { id: "dropbox", label: s.sources.tabs.dropbox, icon: Cloud },
  { id: "research", label: s.sources.tabs.research, icon: Sparkles },
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
  const query = useUi((st) => st.importDialog.query);
  const setSourcesOpen = useUi((st) => st.setSourcesOpen);
  const done = () => {
    setSourcesOpen(space.id, true);
    onOpenChange(false);
  };
  useEffect(() => {
    if (open) setTab(initialTab ?? "file");
  }, [open, initialTab]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={s.sources.importTitle} className="w-[min(680px,calc(100vw-32px))]">
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List aria-label={s.sources.importTitle} className="mb-4 flex flex-wrap gap-1">
          {TABS.map((t) => (
            <Tabs.Trigger
              key={t.id}
              value={t.id}
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-medium text-muted hover:bg-surface-2 data-[state=active]:bg-accent-soft data-[state=active]:text-accent-text"
            >
              <t.icon size={15} /> {t.label}
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
          <ResearchPanel key={query ?? ""} space={space} initialQuery={query} done={done} />
        </Tabs.Content>
      </Tabs.Root>
    </Dialog>
  );
}

function FileTab({ space, done }: { space: Space; done: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const choose = async () => {
    setBusy(true);
    try {
      const paths = await pickFiles();
      if (!paths.length) return;
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
      if (failures.length < paths.length) done();
    } catch (e) {
      toastError(s.sources.importFailed, e, choose);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-10 text-center">
      <FileUp size={26} className="text-muted" />
      <p className="mt-3 font-medium">Drop files on the Sources pane, or choose them here</p>
      <p className="mt-1 text-sm text-muted">{s.sources.fileHelp}</p>
      <Button variant="primary" className="mt-5" disabled={busy} onClick={choose}>
        {busy && <Spinner size={15} className="text-on-accent" />} {s.sources.chooseFiles}
      </Button>
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
  return (
    <div className="space-y-3 pb-2">
      <div>
        <Label htmlFor="paste-title">{s.sources.pasteTitle}</Label>
        <Input id="paste-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" />
      </div>
      <div>
        <Label htmlFor="paste-body">{s.sources.pasteBody}</Label>
        <Textarea id="paste-body" rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder={s.sources.pastePlaceholder} />
      </div>
      <div className="flex justify-end">
        <Button variant="primary" disabled={!text.trim() || busy} onClick={submit}>
          {busy ? s.sources.importing : s.sources.import}
        </Button>
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
  return (
    <form
      className="space-y-3 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) submit();
      }}
    >
      <Label htmlFor={`url-${kind}`}>{kind === "youtube" ? "YouTube link" : "Web address"}</Label>
      <Input
        id={`url-${kind}`}
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={kind === "youtube" ? s.sources.youtubePlaceholder : s.sources.urlPlaceholder}
      />
      <p className="text-xs text-muted">
        {kind === "youtube"
          ? "The transcript is imported with timestamps. Videos without captions can't be imported."
          : "The page's main text is saved as a source; menus and ads are dropped."}
      </p>
      {url && !valid && <p className="text-xs text-danger">{kind === "youtube" ? "That isn't a YouTube link." : "That doesn't look like a web address."}</p>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={!valid || busy}>
          {busy && <Spinner size={15} className="text-on-accent" />} {busy ? s.sources.importing : s.sources.import}
        </Button>
      </div>
    </form>
  );
}
