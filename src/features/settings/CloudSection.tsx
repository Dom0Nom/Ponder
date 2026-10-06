import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Cloud, Copy, ExternalLink, LogIn, LogOut, Trash2 } from "lucide-react";
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
import { StatusPill } from "./ProviderCard";

export function CloudSection() {
  return (
    <ul className="space-y-3" data-testid="cloud-section">
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
  const name = s.cloud.names[service];
  useEffect(() => {
    setClientId(st?.clientId ?? "");
  }, [st?.clientId]);

  const saveClient = useMutation({
    mutationFn: (remove?: boolean) => api.cloudSetClient(service, remove ? "" : clientId, remove ? null : secret || null),
    onSuccess: (next, remove) => {
      qc.setQueryData(ck.status(service), next);
      setSecret("");
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

  return (
    <li className="rounded-[var(--radius-card)] border border-border p-4" aria-label={name}>
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-surface-2 p-2 text-muted">
          <Cloud size={16} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] font-medium">{name}</p>
          <div className="mt-1.5 flex min-w-0">
            <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
          </div>
        </div>
        {st?.configured &&
          (st.state === "signedIn" ? (
            <Button size="sm" variant="ghost" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
              <LogOut size={14} aria-hidden /> {s.cloud.disconnect}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              onClick={() => connect.mutate()}
              disabled={connect.isPending || st.state === "pending" || (service === "google" && !st.hasSecret)}
            >
              <LogIn size={14} aria-hidden /> {st.state === "error" ? s.cloud.reconnect : s.cloud.connect}
            </Button>
          ))}
      </div>
      {st?.state === "pending" && <p className="mt-2 text-xs text-muted">{s.cloud.browserHint}</p>}

      {status.isLoading && <Skeleton className="mt-4 h-16" />}
      {status.error && <ErrorState title={s.errors.generic} error={status.error} onRetry={() => status.refetch()} />}

      {st && (
        <form
          id={formId}
          className="mt-4 space-y-3"
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
              <p className="mt-1 text-xs text-muted">{s.cloud.clientSecretHelp}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" variant="secondary" disabled={!clientId.trim() || !dirty || saveClient.isPending || (needsSecret && !st.configured)}>
              {saveClient.isPending && <Spinner size={14} />} {s.cloud.saveClient}
            </Button>
            {st.configured && (
              <Button size="sm" variant="ghost" onClick={() => saveClient.mutate(true)} disabled={saveClient.isPending}>
                <Trash2 size={14} aria-hidden /> {s.cloud.removeClient}
              </Button>
            )}
          </div>
        </form>
      )}

      <details className="group mt-3">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-accent-text">
          <ChevronRight size={14} className="transition-transform group-open:rotate-90" aria-hidden />
          {s.cloud.setupHelp}
        </summary>
        <ol className="mt-2 list-decimal space-y-1.5 pl-6 text-sm text-muted">
          {s.cloud.steps[service].map((step, i) => (
            <li key={i}>
              {step.text}{" "}
              {step.link && (
                <button type="button" className="inline-flex items-center gap-0.5 text-accent-text hover:underline" onClick={() => openExternal(step.link)}>
                  {new URL(step.link).host} <ExternalLink size={12} aria-hidden />
                </button>
              )}
              {service === "dropbox" && i === 2 && st?.redirectUri && <RedirectUri uri={st.redirectUri} />}
            </li>
          ))}
        </ol>
      </details>
    </li>
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
      <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-fg">{uri}</code>
      <button type="button" aria-label={s.common.copy} onClick={copy} className="rounded-full p-1 text-muted hover:bg-surface-2 hover:text-fg">
        <Copy size={13} />
      </button>
    </span>
  );
}
