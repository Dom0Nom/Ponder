import { useEffect } from "react";
import { events } from "../lib/ipc";
import { drainInbox } from "../lib/inbox";
import { queryClient, qk } from "../lib/queries";
import { qkNotes } from "../features/notes/keys";
import { s } from "../lib/strings";
import { toast, toastError } from "../components/ui/toast";

/** Imports sources and notes other apps queued through the MCP server. */
export function useInbox() {
  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const { added, failed } = await drainInbox();
        if (!alive) return;
        void queryClient.invalidateQueries({ queryKey: qk.spaces });
        for (const spaceId of new Set(added.map((a) => a.spaceId))) {
          void queryClient.invalidateQueries({ queryKey: qk.sources(spaceId) });
          void queryClient.invalidateQueries({ queryKey: qkNotes(spaceId) });
        }
        if (added.length === 1) toast.success(s.inbox.added(added[0].title));
        else if (added.length > 1) toast.success(s.inbox.addedMany(added.length));
        for (const f of failed) toastError(s.inbox.failed, f.error);
      } catch (e) {
        if (alive) toastError(s.inbox.failed, e);
      }
    };
    void run();
    const un = events.inboxChanged(() => void run());
    return () => {
      alive = false;
      void un.then((f) => f()).catch(() => {});
    };
  }, []);
}
