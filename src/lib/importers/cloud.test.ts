import { describe, expect, it } from "vitest";
import { backTo, dropboxTrail, enterFolder, formatSize, importKind, originFor, typeLabel } from "./cloud";

const file = (name: string, mimeType: string | null = null) => ({ name, mimeType, folder: false });

describe("importKind", () => {
  it("accepts supported files by extension or MIME type", () => {
    expect(importKind(file("paper.PDF"))).toBe("pdf");
    expect(importKind(file("book.epub"))).toBe("epub");
    expect(importKind(file("essay.docx"))).toBe("docx");
    expect(importKind(file("notes.md"))).toBe("markdown");
    expect(importKind(file("notes.markdown"))).toBe("markdown");
    expect(importKind(file("todo.txt"))).toBe("text");
    expect(importKind(file("scan", "application/pdf"))).toBe("pdf");
  });

  it("exports Google Workspace files and skips other Google types", () => {
    expect(importKind(file("Lecture", "application/vnd.google-apps.document"))).toBe("markdown");
    expect(importKind(file("Deck", "application/vnd.google-apps.presentation"))).toBe("text");
    expect(importKind(file("Grades", "application/vnd.google-apps.spreadsheet"))).toBe("text");
    expect(importKind(file("Quiz", "application/vnd.google-apps.form"))).toBeNull();
    expect(typeLabel(file("Quiz", "application/vnd.google-apps.form"))).toBe("Google file");
    expect(typeLabel(file("Lecture", "application/vnd.google-apps.document"))).toBe("Google Doc");
  });

  it("rejects folders and unsupported files", () => {
    expect(importKind({ name: "Biology", mimeType: null, folder: true })).toBeNull();
    expect(importKind(file("photo.jpg", "image/jpeg"))).toBeNull();
    expect(importKind(file("archive.zip"))).toBeNull();
    expect(importKind(file(".pdf"))).toBeNull();
    expect(typeLabel(file("photo.jpg"))).toBe("JPG");
  });
});

describe("breadcrumbs", () => {
  it("builds the Dropbox trail from a path", () => {
    expect(dropboxTrail(null, "Dropbox")).toEqual([{ id: null, name: "Dropbox" }]);
    expect(dropboxTrail("/Uni/Bio 101", "Dropbox")).toEqual([
      { id: null, name: "Dropbox" },
      { id: "/Uni", name: "Uni" },
      { id: "/Uni/Bio 101", name: "Bio 101" },
    ]);
  });

  it("keeps a Drive folder stack", () => {
    const root = [{ id: null, name: "My Drive" }];
    const a = enterFolder(root, { id: "f1", name: "Uni" });
    const b = enterFolder(a, { id: "f2", name: "Bio" });
    expect(b.map((c) => c.id)).toEqual([null, "f1", "f2"]);
    expect(backTo(b, 1)).toEqual(a);
    expect(backTo(b, 0)).toEqual(root);
    expect(backTo(b, -1)).toEqual(root);
  });
});

it("formats sizes and origins", () => {
  expect(formatSize(null)).toBe("—");
  expect(formatSize(512)).toBe("512 B");
  expect(formatSize(1536)).toBe("1.5 KB");
  expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
  expect(formatSize(300 * 1024 * 1024)).toBe("300 MB");
  expect(originFor("google", "abc")).toBe("gdrive://abc");
  expect(originFor("dropbox", "/A/b.pdf")).toBe("dropbox:///A/b.pdf");
});
