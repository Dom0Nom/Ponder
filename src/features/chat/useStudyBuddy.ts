import { useEffect, useRef } from "react";
import { api } from "../../lib/ipc";
import { queryClient, qk, useSettings } from "../../lib/queries";
import { initialBuddyState, stepBuddy, type BuddyEvent, type BuddyOptions } from "../../lib/buddy/engine";
import { buddyInstruction, buddyNote, hyperfocusNote } from "../../lib/buddy/prompts";
import { readPrefs, type FocusPrefs } from "../../lib/focusPrefs";
import { s as strings } from "../../lib/strings";
import { runTurn } from "../../lib/chat/runner";
import { NoModelError } from "../../lib/chat/llm";
import { formatMinutes } from "../../lib/utils";
import { CITE_RE } from "../../lib/chat/citations";
import { useUi } from "../../stores/ui";
import { useChatStream } from "../../stores/chatStream";
import { useFocusStore } from "../focus/focusStore";
import { toast, toastError } from "../../components/ui/toast";

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

const optionsOf = (p: FocusPrefs): BuddyOptions => ({ hyperfocusMins: p.hyperfocus.enabled ? p.hyperfocus.minutes : 0 });

async function handleHyperfocus(ev: BuddyEvent, prefs: FocusPrefs) {
  const st = ev.state;
  const idea = prefs.breakMenu.length ? prefs.breakMenu[Math.floor(Math.random() * prefs.breakMenu.length)] : "";
  const text = hyperfocusNote(st, idea ? [idea] : []);
  const canBreak = !!st && st.phase === "work" && (st.technique === "flowtime" || st.technique === "timebox");
  toast(strings.focus.hyperfocus.toastTitle, {
    description: text,
    duration: 20000,
    action: canBreak
      ? {
          label: strings.focus.hyperfocus.takeBreak,
          onClick: () =>
            api
              .focusEndWork()
              .then((next) => useFocusStore.getState().setState(next))
              .catch((e) => toastError(strings.focus.actionFailed, e)),
        }
      : undefined,
  });

  const route = useUi.getState().route;
  const spaceId = ev.spaceId ?? (route.name === "space" ? route.spaceId : null);
  if (!spaceId) return;
  const threadId = await threadFor(spaceId);
  await api.addMessage({
    threadId,
    role: "buddy",
    content: text,
    meta: { buddyKind: ev.kind, focus: ev.state },
  });
  queryClient.invalidateQueries({ queryKey: qk.messages(threadId) });
}

async function handle(ev: BuddyEvent, prefs: FocusPrefs) {
  if (ev.kind === "hyperfocus") return handleHyperfocus(ev, prefs);
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
    const clean = content
      .replaceAll("{{general}}", "")
      .replaceAll("{{/general}}", "")
      .replace(CITE_RE, "")
      .replace(/ +([.,;:!?])/g, "$1");
    const body = [stats, clean].filter(Boolean).join("\n\n");
    const date = new Date().toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    await api.addJournal(spaceId, "session-summary", `Focus session · ${date}`, body || "Session ended.");
    await api.focusSetSummary(ev.sessionId, body).catch(() => {});
    queryClient.invalidateQueries({ queryKey: qk.journal(spaceId) });
    queryClient.invalidateQueries({ queryKey: ["focusHistory"] });
  }
}

/** Watches the focus timer and posts study-buddy turns into the session's chat. */
export function useStudyBuddy() {
  const { data: settings } = useSettings();
  const prefsRef = useRef<FocusPrefs>(readPrefs(settings));
  prefsRef.current = readPrefs(settings);

  useEffect(() => {
    let state = initialBuddyState;
    let ready = false;
    const unsub = useFocusStore.subscribe((s, prev) => {
      if (!ready || s.state === prev.state) return;
      const r = stepBuddy(state, s.state, optionsOf(prefsRef.current));
      state = r.state;
      for (const ev of r.events) {
        chain = chain.then(() => handle(ev, prefsRef.current)).catch((e) => toastError("Study buddy couldn't post", e));
      }
    });
    // initialize from the backend's current session so a UI reload doesn't re-announce anything
    Promise.all([api.focusState().catch(() => null), api.getSettings().catch(() => undefined)]).then(
      ([st, settings]) => {
        if (settings) prefsRef.current = readPrefs(settings);
        state = stepBuddy(state, st, optionsOf(prefsRef.current)).state;
        ready = true;
      },
    );
    return unsub;
  }, []);
}
