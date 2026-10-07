import { LearnChevron } from "../../components/motion/LearnChevron";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Fragment, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/input";
import { toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { catalog, catalogOrder, type CatalogEntry } from "../../lib/providers/catalog";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Provider, ProviderKind, ProviderType } from "../../lib/types";
import { useUi } from "../../stores/ui";
import { openExternal } from "./openExternal";
import { pk } from "./providerQueries";
import { ProviderIcon } from "../../components/ProviderIcon";
import { SubPage } from "./SubPage";

const DESIGNED: Record<ProviderKind, ProviderType[]> = {
  local: ["lmstudio", "ollama"],
  oauth: ["chatgpt-oauth", "xai-oauth"],
  apiKey: ["anthropic", "openai", "openrouter", "openai-compatible"],
};

function Tile({ type, onPick }: { type: ProviderType; onPick: (t: ProviderType) => void }) {
  const hint = s.providers.tileHint[type];
  return (
    <button
      onClick={() => onPick(type)}
      className="t-learn flex h-12 items-center gap-3 rounded-tile border border-border px-3 text-left hover:bg-fill-faint"
    >
      <ProviderIcon type={type} size={20} />
      <span className="flex flex-1 flex-col">
        <span className="font-semibold">{catalog[type].tileLabel ?? catalog[type].label}</span>
        {hint && <span className="text-label text-muted">{hint}</span>}
      </span>
      <LearnChevron size={14} />
    </button>
  );
}

function TypeGrid({ onPick }: { onPick: (t: ProviderType) => void }) {
  const groups: ProviderKind[] = ["local", "oauth", "apiKey"];
  const shown = new Set(groups.flatMap((g) => DESIGNED[g]));
  const extra = catalogOrder.filter((t) => !shown.has(t));
  return (
    <>
      {groups.map((g) => (
        <Fragment key={g}>
          <p className="text-label font-semibold text-muted">{s.providers.groups[g]}</p>
          <div className="grid grid-cols-2 gap-2">
            {DESIGNED[g].map((t) => (
              <Tile key={t} type={t} onPick={onPick} />
            ))}
          </div>
        </Fragment>
      ))}
      <p className="text-label font-semibold text-muted">{s.providers.moreProviders}</p>
      <div className="grid grid-cols-2 gap-2">
        {extra.map((t) => (
          <Tile key={t} type={t} onPick={onPick} />
        ))}
      </div>
      <p className="text-caption text-muted">{s.providers.claudeNote}</p>
    </>
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
      className="flex flex-col gap-4"
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
          <p className="mt-1.5 text-caption text-muted">{s.providers.baseUrlHelp}</p>
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
                className="inline-flex items-center gap-1 text-label font-semibold text-fg hover:underline"
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
          <p className="mt-1.5 text-caption text-muted">{s.providers.apiKeyHelp}</p>
        </div>
      )}
      {entry.kind === "oauth" && (
        <p className="rounded-pane bg-fill-subtle px-3 py-2.5 text-body text-muted">
          {entry.type === "chatgpt-oauth" ? s.providers.signInChatgptHelp : s.providers.signInGrokHelp}
        </p>
      )}
    </form>
  );
}

export function AddProviderPage({ type }: { type?: ProviderType }) {
  const qc = useQueryClient();
  const navigate = useUi((st) => st.navigate);
  const setJustAdded = useUi((st) => st.setJustAddedProvider);
  const [busy, setBusy] = useState(false);
  const entry = type ? catalog[type] : null;

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
      setJustAdded(created.id);
      navigate({ name: "settings", section: "providers" });
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
    <SubPage
      crumb={s.settings.crumbProviders}
      section="providers"
      title={entry ? entry.label : s.providers.addTitle}
      footer={
        entry && (
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate({ name: "settings", page: { kind: "addProvider" } })} disabled={busy}>
              <ArrowLeft size={14} aria-hidden />
              {s.common.back}
            </Button>
            <Button variant="primary" type="submit" form="add-provider-form" disabled={busy}>
              {busy ? s.providers.saving : s.providers.save}
            </Button>
          </>
        )
      }
    >
      {entry ? (
        <ProviderForm key={entry.type} entry={entry} busy={busy} onSubmit={submit} />
      ) : (
        <TypeGrid onPick={(t) => navigate({ name: "settings", page: { kind: "addProvider", type: t } })} />
      )}
    </SubPage>
  );
}
