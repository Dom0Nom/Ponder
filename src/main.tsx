import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import "./styles/print.css";

/** The calculator pop-out window renders only the calculator (`?window=calculator` or the Tauri window label). */
async function isCalculatorWindow(mock: boolean): Promise<boolean> {
  if (new URLSearchParams(window.location.search).get("window") === "calculator") return true;
  if (mock) return false;
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return getCurrentWebviewWindow().label === "calculator";
}

/** The ask-anything overlay renders only the question box (`?window=ask` or the Tauri window label). */
async function isAskWindow(mock: boolean): Promise<boolean> {
  if (new URLSearchParams(window.location.search).get("window") === "ask") return true;
  if (mock) return false;
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  return getCurrentWebviewWindow().label === "ask";
}

async function boot() {
  // Outside Tauri (plain browser / Playwright) the backend is replaced by an in-memory mock.
  const mock = !("__TAURI_INTERNALS__" in window) || import.meta.env.VITE_MOCK_IPC === "1";
  if (mock) {
    const { installMockBackend } = await import("./test/mockBackend");
    installMockBackend();
  }
  const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
  if (await isCalculatorWindow(mock)) {
    const { CalculatorWindow } = await import("./features/calculator/CalculatorWindow");
    root.render(
      <React.StrictMode>
        <CalculatorWindow />
      </React.StrictMode>,
    );
    return;
  }
  if (await isAskWindow(mock)) {
    const { AskWindow } = await import("./features/ask/AskWindow");
    root.render(
      <React.StrictMode>
        <AskWindow />
      </React.StrictMode>,
    );
    return;
  }
  const { App } = await import("./app/App");
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

boot();
