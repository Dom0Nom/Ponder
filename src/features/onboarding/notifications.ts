import { isNativeApp } from "../../lib/utils";

export type Perm = "default" | "granted" | "denied" | "unavailable";

const web = (): Perm => (typeof Notification === "undefined" ? "unavailable" : (Notification.permission as Perm));

export async function readPermission(): Promise<Perm> {
  if (!isNativeApp()) return web();
  const { isPermissionGranted } = await import("@tauri-apps/plugin-notification");
  return (await isPermissionGranted()) ? "granted" : "default";
}

export async function requestPermission(): Promise<Perm> {
  if (!isNativeApp()) return typeof Notification === "undefined" ? "unavailable" : ((await Notification.requestPermission()) as Perm);
  const { requestPermission: request } = await import("@tauri-apps/plugin-notification");
  return (await request()) === "granted" ? "granted" : "denied";
}
