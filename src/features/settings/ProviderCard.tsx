import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ellipsis } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ProviderIcon } from "../../components/ProviderIcon";
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
import { useUi } from "../../stores/ui";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "../../components/ui/menu";
import { pk, storeModels, useHasSecret, useOAuthStatus } from "./providerQueries";

const signedInLabel = (account?: string | null) => (account ? s.providers.status.signedInAs(account) : s.providers.status.signedIn);

export type Tone = "ok" | "warn" | "error" | "muted" | "pending";

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
        <p className="mt-1.5 text-caption text-muted">{s.providers.apiKeyHelp}</p>
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
  const navigate = useUi((st) => st.navigate);
  const setJustAdded = useUi((st) => st.setJustAddedProvider);
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

  const signIn = () =>
    provider.type === "chatgpt-oauth"
      ? chatgptSignIn.mutate()
      : navigate({ name: "settings", page: { kind: "grokSignIn", providerId: provider.id } });
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!justAdded || autoStarted.current) return;
    autoStarted.current = true;
    setJustAdded(null);
    if (isOAuth) signIn();
    else test.mutate();
  }, [justAdded]);

  const oauthState = oauth.data?.state;
  let status: { tone: Tone; label: string };
  if (testError) status = { tone: "error", label: testError };
  else if (isOAuth) {
    if (oauth.isLoading) status = { tone: "pending", label: s.common.loading };
    else if (oauthState === "signedIn")
      status = { tone: "ok", label: signedInLabel(oauth.data?.account ?? provider.config.account) };
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

  const statusText =
    status.tone === "muted" && provider.kind === "local" && !testError
      ? `${s.providers.status.local} · ${s.providers.modelCount(models.length)}`
      : status.label;

  return (
    <li className="flex items-center gap-3.5 px-3.5 py-3" aria-label={provider.name}>
      <ProviderIcon type={provider.type} baseUrl={provider.baseUrl} size={20} />
      <span
        className="min-w-0 flex-1 truncate text-input font-semibold"
        title={entry?.baseUrlEditable ? baseUrlOf(provider) : undefined}
      >
        {provider.name}
      </span>
      <span
        className={cn(
          "flex min-w-0 max-w-[40%] items-center gap-1.5 text-caption text-muted",
          status.tone === "error" && "text-danger",
          status.tone === "warn" && "text-warn",
        )}
      >
        {status.tone === "pending" && <Spinner size={12} />}
        <span className="truncate">{statusText}</span>
      </span>
      {(!isOAuth || signedIn) && (
        <Button variant="ghost" size="sm" onClick={() => test.mutate()} disabled={test.isPending}>
          {test.isPending ? s.providers.testing : s.providers.test}
        </Button>
      )}
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost-muted" size="icon-sm" aria-label={s.providers.more}>
            <Ellipsis size={15} />
          </Button>
        </MenuTrigger>
        <MenuContent align="end" className="min-w-[180px]">
          {!isOAuth && <MenuItem onSelect={() => setKeyOpen(true)}>{secret.data ? s.providers.replaceKey : s.providers.addKey}</MenuItem>}
          {isOAuth && !signedIn && (
            <MenuItem disabled={chatgptSignIn.isPending || oauthState === "pending"} onSelect={signIn}>
              {provider.type === "chatgpt-oauth" ? s.providers.signInChatgpt : s.providers.signInGrok}
            </MenuItem>
          )}
          {isOAuth && signedIn && (
            <MenuItem disabled={signOut.isPending} onSelect={() => signOut.mutate()}>
              {s.providers.signOut}
            </MenuItem>
          )}
          {models.length > 0 && (
            <MenuSub>
              <MenuSubTrigger>{s.providers.defaultModel}</MenuSubTrigger>
              <MenuSubContent className="max-h-[320px] overflow-y-auto">
                <MenuRadioGroup value={provider.config.defaultModel ?? ""} onValueChange={(m) => setDefaultModel.mutate(m)}>
                  {models.map((m) => (
                    <MenuRadioItem key={m} value={m}>
                      {m}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuSubContent>
            </MenuSub>
          )}
          <MenuSeparator />
          <MenuItem danger onSelect={() => setRemoveOpen(true)}>
            {s.common.remove}
          </MenuItem>
        </MenuContent>
      </Menu>
      {!isOAuth && <KeyDialog provider={provider} open={keyOpen} onOpenChange={setKeyOpen} />}
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
