import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Info, KeyRound, LogIn, Server } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Input, Label } from "../../components/ui/input";
import { toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { catalog, catalogOrder, type CatalogEntry } from "../../lib/providers/catalog";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Provider, ProviderKind, ProviderType } from "../../lib/types";
import { cn } from "../../lib/utils";
import { openExternal } from "./openExternal";
import { pk } from "./providerQueries";

const groupIcon: Record<ProviderKind, typeof Server> = { local: Server, oauth: LogIn, apiKey: KeyRound };

function TypeGrid({ onPick }: { onPick: (t: ProviderType) => void }) {
  const groups: ProviderKind[] = ["local", "oauth", "apiKey"];
  return (
    <div className="space-y-5 pb-2">
      {groups.map((g) => {
        const Icon = groupIcon[g];
        return (
          <div key={g}>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              <Icon size={14} aria-hidden />
              {s.providers.groups[g]}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {catalogOrder
                .filter((t) => catalog[t].kind === g)
                .map((t) => (
                  <button
                    key={t}
                    onClick={() => onPick(t)}
                    className="rounded-xl border border-border bg-surface px-3 py-2.5 text-left text-sm font-medium transition-colors hover:border-accent hover:bg-accent-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    {catalog[t].label}
                  </button>
                ))}
            </div>
          </div>
        );
      })}
      <p className="flex gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-xs text-muted">
        <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
        {s.providers.claudeNote}
      </p>
    </div>
  );
}

function ProviderForm({
  entry,
  busy,
  onSubmit,
}: {
  entry: CatalogEntry;
  busy: boolean;
  onSubmit: (v: { name: string; baseUrl: string; key: string }) => void;
}) {
  const [name, setName] = useState(entry.label);
  const [baseUrl, setBaseUrl] = useState(entry.defaultBaseUrl);
  const [key, setKey] = useState("");
  const showKey = entry.kind !== "oauth" && (entry.needsKey || entry.type === "openai-compatible");
  const valid = name.trim() && (!entry.baseUrlEditable || baseUrl.trim()) && (!entry.needsKey || key.trim());
  return (
    <form
      id="add-provider-form"
      className="space-y-4 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !busy) onSubmit({ name: name.trim(), baseUrl: baseUrl.trim(), key: key.trim() });
      }}
    >
      <div>
        <Label htmlFor="prov-name">{s.providers.name}</Label>
        <Input id="prov-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </div>
      {entry.baseUrlEditable && (
        <div>
          <Label htmlFor="prov-url">{s.providers.baseUrl}</Label>
          <Input
            id="prov-url"
            value={baseUrl}
            placeholder="http://localhost:1234/v1"
            onChange={(e) => setBaseUrl(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
          />
          <p className="mt-1 text-xs text-muted">{s.providers.baseUrlHelp}</p>
        </div>
      )}
      {showKey && (
        <div>
          <div className="flex items-baseline justify-between">
            <Label htmlFor="prov-key">{entry.needsKey ? s.providers.apiKey : s.providers.apiKeyOptional}</Label>
            {entry.needsKey && (
              <button
                type="button"
                onClick={() => openExternal(entry.docsUrl)}
                className="inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline"
              >
                {s.providers.getKey}
                <ExternalLink size={12} aria-hidden />
              </button>
            )}
          </div>
          <Input
            id="prov-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">{s.providers.apiKeyHelp}</p>
        </div>
      )}
      {entry.kind === "oauth" && (
        <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-sm text-muted">
          {entry.type === "chatgpt-oauth" ? s.providers.signInChatgptHelp : s.providers.signInGrokHelp}
        </p>
      )}
    </form>
  );
}

export function AddProviderDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdded: (p: Provider) => void;
}) {
  const qc = useQueryClient();
  const [type, setType] = useState<ProviderType | null>(null);
  const [busy, setBusy] = useState(false);
  const entry = type ? catalog[type] : null;

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) setTimeout(() => setType(null), 200);
  };

  const submit = async (v: { name: string; baseUrl: string; key: string }) => {
    if (!entry) return;
    setBusy(true);
    let created: Provider | null = null;
    try {
      created = await api.saveProvider({
        type: entry.type,
        kind: entry.kind,
        name: v.name,
        baseUrl: entry.baseUrlEditable ? v.baseUrl : null,
        config: {},
      });
      if (v.key) {
        await api.setSecret(created.id, v.key);
        qc.invalidateQueries({ queryKey: pk.secret(created.id) });
      }
      await qc.invalidateQueries({ queryKey: qk.providers });
      close(false);
      onAdded(created);
    } catch (e) {
      if (created) {
        await api.deleteProvider(created.id).catch(() => {});
        qc.invalidateQueries({ queryKey: qk.providers });
      }
      toastError(s.errors.generic, e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={entry ? entry.label : s.providers.addTitle}
      description={entry ? undefined : s.providers.addBody}
      className={cn(!entry && "w-[min(620px,calc(100vw-32px))]")}
      footer={
        entry && (
          <>
            <Button variant="ghost" onClick={() => setType(null)} disabled={busy}>
              <ArrowLeft size={16} aria-hidden />
              {s.common.back}
            </Button>
            <Button variant="primary" type="submit" form="add-provider-form" disabled={busy}>
              {busy ? s.providers.saving : s.providers.save}
            </Button>
          </>
        )
      }
    >
      {entry ? <ProviderForm key={entry.type} entry={entry} busy={busy} onSubmit={submit} /> : <TypeGrid onPick={setType} />}
    </Dialog>
  );
}
