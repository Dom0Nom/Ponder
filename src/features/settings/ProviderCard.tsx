import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, CircleDashed, KeyRound, LogIn, LogOut, PlugZap, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { ConfirmDialog, Dialog } from "../../components/ui/dialog";
import { Input, Label } from "../../components/ui/input";
import { Spinner } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { baseUrlOf, catalog } from "../../lib/providers/catalog";
import { testConnection } from "../../lib/providers/model";
import { qk, useSettings } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { ModelRef, Provider } from "../../lib/types";
import { cn } from "../../lib/utils";
import { NativeSelect } from "./NativeSelect";
import { pk, storeModels, useHasSecret, useOAuthStatus } from "./providerQueries";
import { XaiDeviceDialog } from "./XaiDeviceDialog";

type Tone = "ok" | "warn" | "error" | "muted" | "pending";

function StatusPill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "error" || tone === "warn" ? CircleAlert : CircleDashed;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "ok" && "bg-accent-soft text-accent-text",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "error" && "bg-danger-soft text-danger",
        (tone === "muted" || tone === "pending") && "bg-surface-2 text-muted",
      )}
    >
      {tone === "pending" ? <Spinner size={12} /> : <Icon size={12} aria-hidden />}
      <span className="truncate">{children}</span>
    </span>
  );
}

function KeyDialog({ provider, open, onOpenChange }: { provider: Provider; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const save = useMutation({
    mutationFn: () => api.setSecret(provider.id, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pk.secret(provider.id) });
      toast.success(s.providers.keySaved);
      onOpenChange(false);
    },
    onError: (e) => toastError(s.errors.generic, e),
  });
  useEffect(() => {
    if (!open) setValue("");
  }, [open]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={s.providers.keyTitle(provider.name)}
      footer={
        <Button variant="primary" type="submit" form={`key-${provider.id}`} disabled={!value.trim() || save.isPending}>
          {s.common.save}
        </Button>
      }
    >
      <form
        id={`key-${provider.id}`}
        className="pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) save.mutate();
        }}
      >
        <Label htmlFor={`key-input-${provider.id}`}>{s.providers.apiKey}</Label>
        <Input
          id={`key-input-${provider.id}`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted">{s.providers.apiKeyHelp}</p>
      </form>
    </Dialog>
  );
}

/** `justAdded` starts sign-in (OAuth) or a connection test right away. */
export function ProviderCard({ provider, justAdded }: { provider: Provider; justAdded?: boolean }) {
  const qc = useQueryClient();
  const entry = catalog[provider.type];
  const isOAuth = provider.kind === "oauth";
  const secret = useHasSecret(provider.id, !isOAuth);
  const oauth = useOAuthStatus(provider.id, isOAuth);
  const { data: settings } = useSettings();
  const [keyOpen, setKeyOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const test = useMutation({
    mutationFn: async () => {
      const r = await testConnection(provider);
      await storeModels(provider, r.models, r.defaultModel);
      return r;
    },
    onSuccess: (r) => {
      setTestError(null);
      qc.invalidateQueries({ queryKey: qk.providers });
      qc.invalidateQueries({ queryKey: qk.settings });
      toast.success(s.providers.testOk(r.models.length));
    },
    onError: (e) => {
      setTestError(e instanceof Error ? e.message : String(e));
      toastError(s.providers.testFailed, e, () => test.mutate());
    },
  });

  const setDefaultModel = useMutation({
    mutationFn: (model: string) => api.saveProvider({ ...provider, config: { ...provider.config, defaultModel: model } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.providers }),
    onError: (e) => toastError(s.errors.generic, e),
  });

  const remove = useMutation({
    mutationFn: async () => {
      await api.deleteProvider(provider.id);
      const def = settings?.defaultModel as ModelRef | null | undefined;
      if (def?.providerId === provider.id) await api.setSetting("defaultModel", null);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.providers });
      qc.invalidateQueries({ queryKey: qk.settings });
      qc.removeQueries({ queryKey: pk.secret(provider.id) });
      toast.success(s.providers.removed);
    },
    onError: (e) => toastError(s.errors.generic, e),
  });

  const chatgptSignIn = useMutation({
    mutationFn: () => api.oauthChatgptStart(provider.id),
    onSuccess: () => qc.setQueryData(pk.oauth(provider.id), { providerId: provider.id, state: "pending" }),
    onError: (e) => toastError(s.providers.signInFailed, e),
  });

  const signOut = useMutation({
    mutationFn: () => api.oauthSignOut(provider.id),
    onSuccess: () => {
      qc.setQueryData(pk.oauth(provider.id), { providerId: provider.id, state: "signedOut" });
      qc.invalidateQueries({ queryKey: qk.providers });
    },
    onError: (e) => toastError(s.errors.generic, e),
  });

  const signIn = () => (provider.type === "chatgpt-oauth" ? chatgptSignIn.mutate() : setDeviceOpen(true));
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!justAdded || autoStarted.current) return;
    autoStarted.current = true;
    if (isOAuth) signIn();
    else test.mutate();
  }, [justAdded]);

  const oauthState = oauth.data?.state;
  let status: { tone: Tone; label: string };
  if (testError) status = { tone: "error", label: testError };
  else if (isOAuth) {
    if (oauth.isLoading) status = { tone: "pending", label: s.common.loading };
    else if (oauthState === "signedIn")
      status = { tone: "ok", label: s.providers.status.signedIn(oauth.data?.account ?? provider.config.account) };
    else if (oauthState === "pending") status = { tone: "pending", label: s.providers.status.pending };
    else if (oauthState === "error") status = { tone: "error", label: oauth.data?.error ?? s.providers.status.error };
    else status = { tone: "muted", label: s.providers.status.signedOut };
  } else if (secret.isLoading) status = { tone: "pending", label: s.common.loading };
  else if (secret.isError) status = { tone: "error", label: String((secret.error as Error).message ?? secret.error) };
  else if (secret.data) status = { tone: "ok", label: s.providers.status.keySaved };
  else if (provider.kind === "local") status = { tone: "muted", label: s.providers.status.local };
  else if (entry?.needsKey) status = { tone: "warn", label: s.providers.status.keyMissing };
  else status = { tone: "muted", label: s.providers.status.keyOptional };

  const models = provider.config.models ?? [];
  const signedIn = oauthState === "signedIn";

  return (
    <li className="rounded-[var(--radius-card)] border border-border p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate text-[0.9375rem] font-medium">{provider.name}</p>
            {provider.name !== entry?.label && <span className="text-xs text-muted">{entry?.label ?? provider.type}</span>}
          </div>
          {entry?.baseUrlEditable && <p className="mt-0.5 truncate font-mono text-xs text-muted">{baseUrlOf(provider)}</p>}
          <div className="mt-2 flex min-w-0">
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
          </div>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label={s.common.remove} title={s.common.remove} onClick={() => setRemoveOpen(true)}>
          <Trash2 size={16} />
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {isOAuth &&
          (signedIn ? (
            <Button size="sm" variant="ghost" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
              <LogOut size={14} aria-hidden />
              {s.providers.signOut}
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={signIn} disabled={chatgptSignIn.isPending || oauthState === "pending"}>
              <LogIn size={14} aria-hidden />
              {provider.type === "chatgpt-oauth" ? s.providers.signInChatgpt : s.providers.signInGrok}
            </Button>
          ))}
        {!isOAuth && (
          <Button size="sm" variant="secondary" onClick={() => setKeyOpen(true)}>
            <KeyRound size={14} aria-hidden />
            {secret.data ? s.providers.replaceKey : s.providers.addKey}
          </Button>
        )}
        {(!isOAuth || signedIn) && (
          <Button size="sm" variant="tonal" onClick={() => test.mutate()} disabled={test.isPending}>
            {test.isPending ? <Spinner size={14} /> : <PlugZap size={14} aria-hidden />}
            {test.isPending ? s.providers.testing : s.providers.test}
          </Button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <span className="shrink-0 text-xs font-medium text-muted">{s.providers.defaultModel}</span>
        {models.length > 0 ? (
          <NativeSelect
            className="min-w-0 flex-1"
            aria-label={s.providers.defaultModel}
            value={provider.config.defaultModel ?? ""}
            onChange={(e) => setDefaultModel.mutate(e.target.value)}
          >
            {!provider.config.defaultModel && <option value="">—</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <span className="text-xs text-faint">{provider.config.defaultModel ?? s.providers.noModels}</span>
        )}
      </div>

      {!isOAuth && <KeyDialog provider={provider} open={keyOpen} onOpenChange={setKeyOpen} />}
      {provider.type === "xai-oauth" && <XaiDeviceDialog provider={provider} open={deviceOpen} onOpenChange={setDeviceOpen} />}
      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={s.providers.removeTitle(provider.name)}
        body={s.providers.removeBody}
        confirmLabel={s.common.remove}
        danger
        onConfirm={() => remove.mutate()}
      />
    </li>
  );
}
