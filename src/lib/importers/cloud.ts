import { api } from "../ipc";
import type { CloudImportResult, CloudItem, CloudService, Source, SourceKind } from "../types";
import { FILE_EXTENSIONS } from "./files";
import type { Importer } from "./types";

/** Google Workspace files are exported to text by the backend. */
export const GOOGLE_EXPORTS: Record<string, { kind: SourceKind; label: string }> = {
  "application/vnd.google-apps.document": { kind: "markdown", label: "Google Doc" },
  "application/vnd.google-apps.presentation": { kind: "text", label: "Google Slides" },
  "application/vnd.google-apps.spreadsheet": { kind: "text", label: "Google Sheet" },
};

const MIME_KINDS: Record<string, SourceKind> = {
  "application/pdf": "pdf",
  "application/epub+zip": "epub",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/markdown": "markdown",
  "text/plain": "text",
};

const EXT_KINDS: Record<string, SourceKind> = { pdf: "pdf", epub: "epub", docx: "docx", md: "markdown", markdown: "markdown", txt: "text" };

export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** The source kind an item would import as, or null when it can't be imported. */
export function importKind(item: Pick<CloudItem, "name" | "folder" | "mimeType">): SourceKind | null {
  if (item.folder) return null;
  const mime = item.mimeType ?? "";
  if (GOOGLE_EXPORTS[mime]) return GOOGLE_EXPORTS[mime].kind;
  if (mime.startsWith("application/vnd.google-apps.")) return null;
  const ext = extensionOf(item.name);
  if (FILE_EXTENSIONS.includes(ext)) return EXT_KINDS[ext];
  return MIME_KINDS[mime] ?? null;
}

const MIME_LABELS: Record<string, string> = {
  "application/pdf": "pdf",
  "application/epub+zip": "epub",
  "image/jpeg": "jpeg",
  "image/png": "png",
  "text/plain": "txt",
  "text/markdown": "md",
};

export function typeLabel(item: Pick<CloudItem, "name" | "folder" | "mimeType">): string {
  if (item.folder) return "Folder";
  const g = item.mimeType ? GOOGLE_EXPORTS[item.mimeType] : undefined;
  if (g) return g.label;
  if (item.mimeType?.startsWith("application/vnd.google-apps.")) return "Google file";
  const ext = extensionOf(item.name) || MIME_LABELS[item.mimeType ?? ""] || "";
  return ext ? ext.toUpperCase() : "File";
}

export function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[u]}`;
}

/** `id` null = the service's root. */
export interface Crumb {
  id: string | null;
  name: string;
}

/** Drive: folders are ids, so the trail is kept as a stack. */
export function enterFolder(trail: Crumb[], folder: Pick<CloudItem, "id" | "name">): Crumb[] {
  return [...trail, { id: folder.id, name: folder.name }];
}

export function backTo(trail: Crumb[], index: number): Crumb[] {
  return trail.slice(0, Math.max(1, index + 1));
}

/** Dropbox: the trail follows from the path itself. */
export function dropboxTrail(path: string | null, rootName: string): Crumb[] {
  const trail: Crumb[] = [{ id: null, name: rootName }];
  if (!path) return trail;
  let acc = "";
  for (const part of path.split("/").filter(Boolean)) {
    acc += `/${part}`;
    trail.push({ id: acc, name: part });
  }
  return trail;
}

export function originFor(service: CloudService, id: string): string {
  return service === "google" ? `gdrive://${id}` : `dropbox://${id}`;
}

/** Imports several items in one backend call; failures come back per file. */
export function importCloudItems(service: CloudService, spaceId: string, items: CloudItem[]): Promise<CloudImportResult> {
  return api.cloudImport(service, spaceId, items);
}

export function cloudImporter(service: CloudService): Importer<CloudItem> {
  return {
    id: service === "google" ? "gdrive" : "dropbox",
    canHandle: (item) => importKind(item) !== null,
    import: async (spaceId, item): Promise<Source> => {
      const res = await importCloudItems(service, spaceId, [item]);
      if (res.sources[0]) return res.sources[0];
      throw new Error(res.failures[0]?.error ?? "Import failed");
    },
  };
}

export const googleDriveImporter = cloudImporter("google");
export const dropboxImporter = cloudImporter("dropbox");
