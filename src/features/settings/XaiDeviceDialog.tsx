import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Spinner } from "../../components/ui/misc";
import { toast } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Provider } from "../../lib/types";
import { openExternal } from "./openExternal";
import { pk, useOAuthStatus } from "./providerQueries";

export function XaiDeviceDialog({
  provider,
  open,
  onOpenChange,
}: {
  provider: Provider;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const status = useOAuthStatus(provider.id, open);
  const start = useMutation({
    mutationFn: () => api.oauthXaiDeviceStart(provider.id),
    onSuccess: () => qc.setQueryData(pk.oauth(provider.id), { providerId: provider.id, state: "pending" }),
  });
  const [copied, setCopied] = useState(false);

  const { mutate: begin, reset } = start;
  useEffect(() => {
    if (open) begin();
    else reset();
  }, [open, begin, reset]);

  const state = status.data?.state;
  useEffect(() => {
    if (open && start.isSuccess && state === "signedIn") {
      toast.success(s.providers.signedIn);
      qc.invalidateQueries({ queryKey: qk.providers });
      onOpenChange(false);
    }
  }, [open, start.isSuccess, state, qc, onOpenChange]);

  const code = start.data;
  const link = code?.verificationUriComplete || code?.verificationUri;
  const flowError = start.isSuccess && state === "error" ? status.data?.error : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={s.providers.deviceTitle} description={s.providers.deviceBody}>
      <div className="pb-4">
        {start.isPending || start.isIdle ? (
          <div className="flex items-center gap-3 py-6 text-sm text-muted" role="status">
            <Spinner />
            {s.providers.deviceStarting}
          </div>
        ) : start.isError ? (
          <ErrorState title={s.providers.signInFailed} error={start.error} onRetry={() => start.mutate()} />
        ) : flowError ? (
          <ErrorState title={s.providers.signInFailed} error={flowError} onRetry={() => start.mutate()} />
        ) : (
          code && (
            <div className="flex flex-col items-center gap-4 pt-2 text-center">
              <div className="flex items-center gap-2">
                <span className="rounded-xl bg-surface-2 px-4 py-2 font-mono text-2xl font-semibold tracking-[0.2em]" aria-label="code">
                  {code.userCode}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={s.providers.copyCode}
                  onClick={() =>
                    navigator.clipboard.writeText(code.userCode).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    })
                  }
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </Button>
              </div>
              {link && (
                <Button variant="primary" onClick={() => openExternal(link)}>
                  <ExternalLink size={16} aria-hidden />
                  {s.providers.deviceOpen}
                </Button>
              )}
              <p className="flex items-center gap-2 text-sm text-muted" role="status">
                <Spinner size={14} />
                {s.providers.deviceWaiting}
              </p>
              <p className="text-xs text-faint">{s.providers.deviceExpires(Math.max(1, Math.round(code.expiresIn / 60)))}</p>
            </div>
          )
        )}
      </div>
    </Dialog>
  );
}
