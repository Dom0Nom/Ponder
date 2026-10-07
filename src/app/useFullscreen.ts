import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isNativeApp } from "../lib/utils";

export function useFullscreen(): boolean {
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!isNativeApp()) return;
    const win = getCurrentWindow();
    let alive = true;
    const check = () => win.isFullscreen().then((v) => alive && setFull(v)).catch(() => {});
    check();
    const off = win.onResized(check);
    return () => {
      alive = false;
      off.then((f) => f());
    };
  }, []);
  return full;
}
