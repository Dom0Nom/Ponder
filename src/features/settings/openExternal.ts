import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toastError } from "../../components/ui/toast";
import { s } from "../../lib/strings";

/** Opens a link in the system browser (a new tab in the browser preview). */
export function openExternal(url: string) {
  if (isTauri()) openUrl(url).catch((e) => toastError(s.errors.generic, e));
  else window.open(url, "_blank", "noopener,noreferrer");
}
