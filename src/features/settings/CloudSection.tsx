import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/input";
import { ErrorState, Skeleton, Spinner } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import type { CloudService } from "../../lib/types";
import { ck, statusPill, useCloudStatus } from "./cloudQueries";
import { openExternal } from "./openExternal";
import { SettingsRow } from "./layout";

export function CloudSection() {
  return (
    <ul data-testid="cloud-section" className="rounded-card border border-border px-4 [&>*+*]:border-t [&>*+*]:border-divider">
      <CloudCard service="google" />
      <CloudCard service="dropbox" />
    </ul>
  );
}

function CloudCard({ service }: { service: CloudService }) {
  const qc = useQueryClient();
  const status = useCloudStatus(service);
  const st = status.data;
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const name = s.cloud.names[service];
  useEffect(() => {
    setClientId(st?.clientId ?? "");
  }, [st?.clientId]);

  const saveClient = useMutation({
    mutationFn: (remove?: boolean) => api.cloudSetClient(service, remove ? "" : clientId, remove ? null : secret || null),
    onSuccess: (next, remove) => {
      qc.setQueryData(ck.status(service), next);
      setSecret("");
      if (!remove) setSetupOpen(false);
      toast.success(remove ? s.cloud.clientRemoved : s.cloud.clientSaved);
    },
    onError: (e) => toastError(s.errors.generic, e),
  });
  const connect = useMutation({
    mutationFn: () => api.cloudConnect(service),
    onSuccess: () => qc.setQueryData(ck.status(service), st ? { ...st, state: "pending", error: null } : st),
    onError: (e) => toastError(s.cloud.connectFailed, e),
  });
  const disconnect = useMutation({
    mutationFn: () => api.cloudDisconnect(service),
    onSuccess: (next) => qc.setQueryData(ck.status(service), next),
    onError: (e) => toastError(s.errors.generic, e),
  });

  const pill = statusPill(st);
  const dirty = clientId.trim() !== (st?.clientId ?? "") || !!secret.trim();
  const needsSecret = service === "google" && !st?.hasSecret && !secret.trim();
  const formId = `cloud-${service}`;
  const panelOpen = setupOpen || (st?.configured === false && dirty);

  return (
    <li aria-label={name}>
      <SettingsRow title={name} description={pill.label}>
        {st?.configured && (
          <Button variant="ghost" size="sm" aria-expanded={panelOpen} onClick={() => setSetupOpen((o) => !o)}>
            {s.common.edit}
          </Button>
        )}
        {st?.state === "signedIn" ? (
          <Button variant="ghost" size="sm" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
            {s.cloud.disconnect}
          </Button>
        ) : st?.configured ? (
          <Button
            variant="secondary"
            onClick={() => connect.mutate()}
            disabled={connect.isPending || st.state === "pending" || (service === "google" && !st.hasSecret)}
          >
            {st.state === "error" ? s.cloud.reconnect : s.cloud.connect}
          </Button>
        ) : (
          <Button variant="secondary" aria-expanded={panelOpen} onClick={() => setSetupOpen((o) => !o)}>
            {s.cloud.connect}
          </Button>
        )}
      </SettingsRow>
      {st?.state === "pending" && <p className="-mt-1 pb-3 text-caption text-muted">{s.cloud.browserHint}</p>}
      {status.isLoading && <Skeleton className="mb-3 h-12" />}
      {status.error && <ErrorState size="sm" title={s.errors.generic} error={status.error} onRetry={() => status.refetch()} />}

      {st && panelOpen && (
        <div className="flex flex-col gap-3 pb-4">
          <form
            id={formId}
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (clientId.trim() && dirty) saveClient.mutate(false);
            }}
          >
            <div>
              <Label htmlFor={`${formId}-id`}>{s.cloud.clientId[service]}</Label>
              <Input
                id={`${formId}-id`}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder={service === "google" ? "1234-abc.apps.googleusercontent.com" : "abc123xyz"}
              />
            </div>
            {service === "google" && (
              <div>
                <Label htmlFor={`${formId}-secret`}>{s.cloud.clientSecret}</Label>
                <Input
                  id={`${formId}-secret`}
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={st.hasSecret ? s.cloud.secretSaved : "GOCSPX-…"}
                />
                <p className="mt-1.5 text-caption text-muted">{s.cloud.clientSecretHelp}</p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={!clientId.trim() || !dirty || saveClient.isPending || (needsSecret && !st.configured)}
              >
                {saveClient.isPending && <Spinner size={14} />} {s.cloud.saveClient}
              </Button>
              {st.configured && (
                <Button size="sm" variant="ghost" onClick={() => saveClient.mutate(true)} disabled={saveClient.isPending}>
                  {s.cloud.removeClient}
                </Button>
              )}
            </div>
          </form>
          <SetupSteps service={service} redirectUri={st.redirectUri} />
        </div>
      )}
    </li>
  );
}

function SetupSteps({ service, redirectUri }: { service: CloudService; redirectUri?: string | null }) {
  return (
    <details className="group">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-medium text-fg">
        <ChevronRight size={14} className="transition-transform group-open:rotate-90" aria-hidden />
        {s.cloud.setupHelp}
      </summary>
      <ol className="mt-2 list-decimal space-y-1.5 pl-6 text-body text-muted">
        {s.cloud.steps[service].map((step, i) => (
          <li key={i}>
            {step.text}{" "}
            {step.link && (
              <button type="button" className="inline-flex items-center gap-0.5 text-fg underline" onClick={() => openExternal(step.link)}>
                {new URL(step.link).host} <ExternalLink size={12} aria-hidden />
              </button>
            )}
            {service === "dropbox" && i === 2 && redirectUri && <RedirectUri uri={redirectUri} />}
          </li>
        ))}
      </ol>
    </details>
  );
}

function RedirectUri({ uri }: { uri: string }) {
  const copy = () =>
    navigator.clipboard.writeText(uri).then(
      () => toast.success(s.common.copied),
      (e) => toastError(s.errors.generic, e),
    );
  return (
    <span className="mt-1 flex items-center gap-2">
      <code className="rounded-kbd bg-fill px-1.5 py-0.5 font-sans text-label text-fg">{uri}</code>
      <button type="button" aria-label={s.common.copy} onClick={copy} className="rounded-btn p-1 text-muted hover:bg-fill hover:text-fg">
        <Copy size={13} />
      </button>
    </span>
  );
}
