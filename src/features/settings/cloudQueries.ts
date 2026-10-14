import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api, events } from "../../lib/ipc";
import type { CloudService, CloudStatus } from "../../lib/types";
import type { Tone } from "./ProviderCard";
import { s } from "../../lib/strings";

export const ck = {
  status: (service: CloudService) => ["cloudStatus", service] as const,
  list: (service: CloudService, folder: string | null, query: string) => ["cloudList", service, folder, query] as const,
};

/** Connection status, kept live from `cloud://status` events. */
export function useCloudStatus(service: CloudService) {
  const qc = useQueryClient();
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    events
      .cloudStatus((st: CloudStatus) => {
        qc.setQueryData(ck.status(st.service), st);
        if (st.state !== "signedIn") qc.removeQueries({ queryKey: ["cloudList", st.service] });
      })
      .then((u) => (cancelled ? u() : (unlisten = u)))
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [qc]);
  return useQuery({ queryKey: ck.status(service), queryFn: () => api.cloudStatus(service) });
}

export function statusPill(st: CloudStatus | undefined): { tone: Tone; label: string } {
  if (!st) return { tone: "pending", label: s.common.loading };
  if (!st.configured) return { tone: "muted", label: s.cloud.status.notConfigured };
  switch (st.state) {
    case "signedIn":
      return { tone: "ok", label: st.account ? s.cloud.status.signedInAs(st.account) : s.cloud.status.signedIn };
    case "pending":
      return { tone: "pending", label: s.cloud.status.pending };
    case "error":
      return { tone: "error", label: st.error ?? s.cloud.status.error };
    default:
      return { tone: "muted", label: s.cloud.status.signedOut };
  }
}
