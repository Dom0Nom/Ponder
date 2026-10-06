import { useEffect } from "react";
import { api } from "../../lib/ipc";
import { queryClient, qk } from "../../lib/queries";
import { initialBuddyState, stepBuddy, type BuddyEvent } from "../../lib/buddy/engine";
import { buddyInstruction, buddyNote } from "../../lib/buddy/prompts";
import { runTurn } from "../../lib/chat/runner";
import { NoModelError } from "../../lib/chat/llm";
import { formatMinutes } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { useChatStream } from "../../stores/chatStream";
import { useFocusStore } from "../focus/focusStore";
import { toastError } from "../../components/ui/toast";

let chain: Promise<void> = Promise.resolve();

async function threadFor(spaceId: string): Promise<string> {
  const ui = useUi.getState();
  const threads = await api.listThreads(spaceId);
  const active = threads.find((t) => t.id === ui.activeThread[spaceId]) ?? threads[0];
  if (active) return active.id;
  const t = await api.createThread(spaceId, "Focus session");
  ui.setActiveThread(spaceId, t.id);
  queryClient.invalidateQueries({ queryKey: qk.threads(spaceId) });
  return t.id;
}

async function waitIdle(threadId: string) {
  for (let i = 0; i < 240 && useChatStream.getState().running[threadId]; i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function handle(ev: BuddyEvent) {
  const route = useUi.getState().route;
  const spaceId = ev.spaceId ?? (route.name === "space" ? route.spaceId : null);
  if (!spaceId) return;
  const space = await api.getSpace(spaceId).catch(() => null);
  if (!space) return;
  const threadId = await threadFor(spaceId);
  await waitIdle(threadId);

  await api.addMessage({
    threadId,
    role: "buddy",
    content: buddyNote(ev.kind, ev.state, ev.previous),
    meta: { buddyKind: ev.kind, focus: ev.state },
  });
  queryClient.invalidateQueries({ queryKey: qk.messages(threadId) });

  const parking = await api.parkingList(ev.sessionId).catch(() => []);
  const ref = ev.state ?? ev.previous;
  const msgs = await api.listMessages(threadId);
  const lastUser = [...msgs].reverse().find((m) => m.role === "user")?.content;

  let content = "";
  try {
    const final = await runTurn({
      space,
      threadId,
      tutorStyle: space.tutorStyle,
      thinking: false,
      focus: ev.state,
      query: lastUser ?? ref?.goal ?? "",
      instruction: buddyInstruction(ev.kind, {
        state: ev.state,
        previous: ev.previous,
        parking: parking.filter((p) => !p.resolved),
        needAppPauses: ref?.needAppCount ?? 0,
      }),
      meta: { buddyKind: ev.kind },
    });
    if (final.status === "complete") content = final.content;
  } catch (e) {
    if (!(e instanceof NoModelError)) throw e;
  }

  if (ev.kind === "session-summary") {
    const p = ev.previous;
    const stats = p
      ? `${formatMinutes(p.totalFocusMs)} focus · ${p.block} block(s) · ${p.pauseCount} pause(s) · ${p.needAppCount} break interruption(s)`
      : "";
    const body = [stats, content.replaceAll("{{general}}", "").replaceAll("{{/general}}", "")].filter(Boolean).join("\n\n");
    const date = new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    await api.addJournal(spaceId, "session-summary", `Focus session · ${date}`, body || "Session ended.");
    await api.focusSetSummary(ev.sessionId, body).catch(() => {});
    queryClient.invalidateQueries({ queryKey: qk.journal(spaceId) });
    queryClient.invalidateQueries({ queryKey: ["focusHistory"] });
  }
}

/** Watches the focus timer and posts study-buddy turns into the session's chat. */
export function useStudyBuddy() {
  useEffect(() => {
    let state = initialBuddyState;
    let ready = false;
    const unsub = useFocusStore.subscribe((s, prev) => {
      if (!ready || s.state === prev.state) return;
      const r = stepBuddy(state, s.state);
      state = r.state;
      for (const ev of r.events) {
        chain = chain.then(() => handle(ev)).catch((e) => toastError("Study buddy couldn't post", e));
      }
    });
    // initialize from the backend's current session so a UI reload doesn't re-announce anything
    api
      .focusState()
      .catch(() => null)
      .then((st) => {
        state = stepBuddy(state, st).state;
        ready = true;
      });
    return unsub;
  }, []);
}
