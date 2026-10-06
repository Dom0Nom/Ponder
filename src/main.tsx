import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";

async function boot() {
  // Outside Tauri (plain browser / Playwright) the backend is replaced by an in-memory mock.
  const mock = !("__TAURI_INTERNALS__" in window) || import.meta.env.VITE_MOCK_IPC === "1";
  if (mock) {
    const { installMockBackend } = await import("./test/mockBackend");
    installMockBackend();
  }
  const harness = mock && new URLSearchParams(location.search).get("harness") === "occlusion";
  const { App } = harness ? await import("./test/OcclusionHarness") : await import("./app/App");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

boot();
