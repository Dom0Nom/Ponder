import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../ipc";
import type { Source } from "../types";
import type { Importer } from "./types";

export const FILE_EXTENSIONS = ["pdf", "epub", "docx", "md", "markdown", "txt"];

export async function pickFiles(): Promise<string[]> {
  const res = await open({
    multiple: true,
    directory: false,
    filters: [{ name: "Documents", extensions: FILE_EXTENSIONS }],
  });
  if (!res) return [];
  return Array.isArray(res) ? res : [res];
}

export const fileImporter: Importer<string> = {
  id: "file",
  canHandle: (path) => FILE_EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() ?? ""),
  import: (spaceId, path): Promise<Source> => api.importFile(spaceId, path),
};

export const pasteImporter: Importer<{ title: string; text: string }> = {
  id: "paste",
  canHandle: (i) => i.text.trim().length > 0,
  import: (spaceId, i) => {
    const title = i.title.trim() || i.text.trim().split("\n")[0].slice(0, 60);
    const kind = /^#{1,6} |\n#{1,6} |\*\*|\[.+\]\(.+\)/.test(i.text) ? "markdown" : "text";
    return api.importText(spaceId, title, i.text, kind);
  },
};
