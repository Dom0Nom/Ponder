import { useEffect } from "react";
import { api, events } from "../lib/ipc";
import { filePathFromUrl, parseDeepLink, resolveTarget, type DeepLink } from "../lib/deeplink";
import { queryClient, qk } from "../lib/queries";
import { s } from "../lib/strings";
import { useUi } from "../stores/ui";
import { useComposer } from "../stores/composer";
import { isYouTubeUrl } from "../lib/importers/youtube";
import { toast, toastError } from "../components/ui/toast";

async function apply(link: DeepLink) {
  const ui = useUi.getState();
  const spaces = await queryClient.fetchQuery({ queryKey: qk.spaces, queryFn: api.listSpaces, staleTime: 0 });
  const current = ui.route.name === "space" ? ui.route.spaceId : null;
  const target = resolveTarget(link, spaces, current);
  if (!target.ok) {
    toast.error(target.error === "noSpace" ? s.deeplink.noSpace : s.deeplink.unknownSpace);
    return;
  }
  const spaceId = target.spaceId;
  if (link.kind === "ask") useComposer.getState().setDraft({ spaceId, text: link.question });
  if (link.kind === "import") {
    const file = filePathFromUrl(link.url);
    ui.setImportDialog(
      file
        ? { open: true, tab: "file", file }
        : { open: true, tab: isYouTubeUrl(link.url) ? "youtube" : "url", url: link.url },
    );
  }
  ui.navigate({ name: "space", spaceId });
}

export function handleDeepLink(raw: string) {
  const res = parseDeepLink(raw);
  if (res.ok) return apply(res.link).catch((e) => toastError(s.deeplink.failed, e));
  toast.error(res.error === "host" ? s.deeplink.unknownHost(res.host ?? "") : s.deeplink.invalid);
}

/** Takes links Rust collected (cold start, second launch, OS open-URL) and acts on them. */
export function useDeepLinks() {
  useEffect(() => {
    let alive = true;
    const drain = async () => {
      try {
        for (const url of await api.deeplinkTake()) if (alive) await handleDeepLink(url);
      } catch (e) {
        toastError(s.deeplink.failed, e);
      }
    };
    void drain();
    const un = events.deeplinkPending(() => void drain());
    return () => {
      alive = false;
      void un.then((f) => f()).catch(() => {});
    };
  }, []);
}
