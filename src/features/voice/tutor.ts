import { toastError } from "../../components/ui/toast";
import { useChatStream } from "../../stores/chatStream";
import { useUi } from "../../stores/ui";
import { useVoice, type VoicePhase } from "../../stores/voice";
import { useFocusStore } from "../focus/focusStore";
import { api } from "../../lib/ipc";
import { storedControls } from "../../lib/chat/controls";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { plainAnswer } from "../../lib/chat/plainAnswer";
import { runTurn } from "../../lib/chat/runner";
import { s } from "../../lib/strings";
import { stopSpeaking, speak } from "../../lib/tts/player";
import { audioFormatOf, speechSettings, transcribe } from "../../lib/tts/speech";
import type { Space, Thread } from "../../lib/types";
import { listen, type Listening } from "../../lib/voice/recorder";

export interface VoiceDeps {
  space: Space;
  thread?: Thread;
  ensureThread: () => Promise<Thread>;
}

interface Session {
  deps: VoiceDeps;
  thread: Thread | null;
  listening: Listening | null;
  unsubscribe: () => void;
}

const MAX_EMPTY = 2;
const SPEAK_KEY = "voice-tutor";

let session: Session | null = null;

const set = (phase: VoicePhase) => useVoice.setState({ phase });
const live = (sess: Session) => session === sess;

function pause(sess: Session) {
  if (live(sess)) set("paused");
}

async function turns(sess: Session) {
  let empty = 0;
  while (live(sess)) {
    set("listening");
    let take;
    try {
      sess.listening = await listen({ onLevel: (level) => live(sess) && useVoice.setState({ level }) });
      if (!live(sess)) return void sess.listening.cancel();
      take = await sess.listening.done;
    } catch (e) {
      sess.listening = null;
      if (live(sess)) {
        toastError(s.speech.dictate.noMic, e);
        stopVoice();
      }
      return;
    }
    sess.listening = null;
    if (!live(sess)) return;
    if (!take) return pause(sess);

    set("transcribing");
    let text: string;
    try {
      const [settings, providers] = await Promise.all([api.getSettings(), api.listProviders()]);
      text = await transcribe(speechSettings(settings), new Uint8Array(await take.blob.arrayBuffer()), audioFormatOf(take.mime), undefined, providers);
    } catch (e) {
      if (live(sess)) {
        toastError(s.speech.dictate.failed, e);
        pause(sess);
      }
      return;
    }
    if (!live(sess)) return;
    if (!text) {
      if (++empty >= MAX_EMPTY) return pause(sess);
      continue;
    }
    empty = 0;
    useVoice.setState({ heard: text });
    set("thinking");

    let answer: string;
    try {
      const { space } = sess.deps;
      const llm = await resolveChatModel(space);
      const thread = sess.thread ?? sess.deps.thread ?? (await sess.deps.ensureThread());
      sess.thread = thread;
      if (!live(sess)) return;
      const final = await runTurn({
        llm,
        space,
        threadId: thread.id,
        tutorStyle: space.tutorStyle,
        controls: storedControls(llm),
        focus: useFocusStore.getState().state,
        userText: text,
        voice: true,
      });
      if (!live(sess)) return;
      if (final.status === "error") throw new Error(final.error ?? s.chat.failed);
      answer = plainAnswer(final.content);
    } catch (e) {
      if (live(sess)) {
        toastError(s.chat.failed, e instanceof NoModelError ? new Error(s.chat.noModel) : e);
        pause(sess);
      }
      return;
    }
    if (!answer) continue;

    set("speaking");
    try {
      await speak(SPEAK_KEY, answer);
    } catch (e) {
      if (live(sess)) {
        toastError(s.speech.failed, e);
        pause(sess);
      }
      return;
    }
  }
}

export function startVoice(deps: VoiceDeps) {
  if (session) return;
  const { space } = deps;
  const sess: Session = { deps, thread: null, listening: null, unsubscribe: () => undefined };
  sess.unsubscribe = useUi.subscribe((st) => {
    const away = st.route.name !== "space" || st.route.spaceId !== space.id;
    const switched = sess.thread != null && st.activeThread[space.id] !== sess.thread.id;
    if (away || switched) stopVoice();
  });
  session = sess;
  useVoice.setState({ phase: "listening", spaceId: space.id, heard: "", level: 0 });
  void turns(sess);
}

export function stopVoice() {
  const sess = session;
  if (!sess) return;
  session = null;
  sess.unsubscribe();
  sess.listening?.cancel();
  stopSpeaking();
  if (sess.thread) useChatStream.getState().stop(sess.thread.id);
  useVoice.setState({ phase: "off", spaceId: null, heard: "", level: 0 });
}

/** The mic button: ends the take, interrupts the tutor, or resumes after a pause. */
export function micPress() {
  const sess = session;
  if (!sess) return;
  const { phase } = useVoice.getState();
  if (phase === "listening") sess.listening?.stop();
  else if (phase === "speaking") stopSpeaking();
  else if (phase === "paused") void turns(sess);
}
