import { api } from "./ipc";
import type { InboxItem } from "./types";
import { FeedFound, webImporter } from "./importers/web";
import { isYouTubeUrl, youtubeImporter } from "./importers/youtube";
import { proxyHttp } from "./importers/http";
import { s } from "./strings";

/** Imports one queued item with the app's own importers and returns what was created. */
export async function importInboxItem(item: InboxItem): Promise<{ id: string; title: string; note: boolean }> {
  switch (item.kind) {
    case "text": {
      const src = await api.importText(item.spaceId, item.title, item.body, "text", null);
      return { id: src.id, title: src.title, note: false };
    }
    case "url": {
      const url = item.target ?? "";
      const importer = isYouTubeUrl(url) ? youtubeImporter(proxyHttp) : webImporter;
      try {
        const src = await importer.import(item.spaceId, url);
        return { id: src.id, title: src.title, note: false };
      } catch (e) {
        if (e instanceof FeedFound) throw new Error(s.inbox.feed);
        throw e;
      }
    }
    case "file": {
      const src = await api.importFile(item.spaceId, item.target ?? "");
      return { id: src.id, title: src.title, note: false };
    }
    case "note": {
      const n = await api.noteSave({ spaceId: item.spaceId, title: item.title, body: item.body, useAsSource: item.useAsSource });
      return { id: n.id, title: n.title, note: true };
    }
  }
}

export interface DrainResult {
  added: { spaceId: string; title: string; note: boolean }[];
  failed: { item: InboxItem; error: unknown }[];
}

let running: Promise<DrainResult> | null = null;

/** Imports everything pending, including items queued while it runs. Concurrent calls share one run. */
export function drainInbox(): Promise<DrainResult> {
  running ??= (async () => {
    const out: DrainResult = { added: [], failed: [] };
    const seen = new Set<string>();
    try {
      for (;;) {
        const batch = (await api.inboxPending()).filter((i) => !seen.has(i.id));
        if (batch.length === 0) break;
        for (const item of batch) {
          seen.add(item.id);
          try {
            const r = await importInboxItem(item);
            await api.inboxFinish(item.id, r.id, null);
            out.added.push({ spaceId: item.spaceId, title: r.title, note: r.note });
          } catch (error) {
            out.failed.push({ item, error });
            await api.inboxFinish(item.id, null, error instanceof Error ? error.message : String(error)).catch(() => {});
          }
        }
      }
      return out;
    } finally {
      running = null;
    }
  })();
  return running;
}
