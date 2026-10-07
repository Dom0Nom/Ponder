import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Loader } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { ErrorState, Spinner, Tooltip } from "../../components/ui/misc";
import { toast } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import { useUi } from "../../stores/ui";
import { openExternal } from "./openExternal";
import { pk, useOAuthStatus } from "./providerQueries";
import { SubPage } from "./SubPage";

export function GrokSignInPage({ providerId }: { providerId: string }) {
  const qc = useQueryClient();
  const navigate = useUi((st) => st.navigate);
  const status = useOAuthStatus(providerId, true);
  const start = useMutation({
    mutationFn: () => api.oauthXaiDeviceStart(providerId),
    onSuccess: () => qc.setQueryData(pk.oauth(providerId), { providerId, state: "pending" }),
  });
  const [copied, setCopied] = useState(false);

  const { mutate: begin } = start;
  useEffect(() => begin(), [begin]);

  const state = status.data?.state;
  useEffect(() => {
    if (start.isSuccess && state === "signedIn") {
      toast.success(s.providers.signedIn);
      qc.invalidateQueries({ queryKey: qk.providers });
      navigate({ name: "settings", section: "providers" });
    }
  }, [start.isSuccess, state, qc, navigate]);

  const code = start.data;
  const link = code?.verificationUriComplete || code?.verificationUri;
  const flowError = start.isSuccess && state === "error" ? status.data?.error : null;

  return (
    <SubPage
      crumb={s.settings.crumbProviders}
      section="providers"
      title={s.providers.deviceTitle}
      description={s.providers.deviceBody}
    >
      {start.isPending || start.isIdle ? (
        <div className="flex items-center gap-3 py-4 text-body text-muted" role="status">
          <Spinner />
          {s.providers.deviceStarting}
        </div>
      ) : start.isError ? (
        <ErrorState size="sm" title={s.providers.signInFailed} error={start.error} onRetry={() => start.mutate()} />
      ) : flowError ? (
        <ErrorState size="sm" title={s.providers.signInFailed} error={flowError} onRetry={() => start.mutate()} />
      ) : (
        code && (
          <>
            <div className="flex items-center justify-center gap-3 rounded-card bg-fill-subtle p-5">
              <span aria-label="code" className="text-code font-semibold leading-[1.45] tabular-nums">
                {code.userCode}
              </span>
              <Tooltip content={s.providers.copyCode}>
                <Button
                  variant="ghost-muted"
                  size="icon-sm"
                  aria-label={s.providers.copyCode}
                  onClick={() =>
                    navigator.clipboard.writeText(code.userCode).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    })
                  }
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </Button>
              </Tooltip>
            </div>
            {link && (
              <Button variant="primary" className="w-full" onClick={() => openExternal(link)}>
                <ExternalLink size={15} aria-hidden />
                {s.providers.deviceOpen}
              </Button>
            )}
            <p role="status" className="flex items-center justify-center gap-2 text-muted">
              <Loader size={14} className="animate-spin" />
              {s.providers.deviceWaiting} · {s.providers.deviceExpires(Math.max(1, Math.round(code.expiresIn / 60)))}
            </p>
          </>
        )
      )}
    </SubPage>
  );
}
