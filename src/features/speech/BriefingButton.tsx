import { generateText } from "ai";
import { Headphones, Square } from "lucide-react";
import { useState } from "react";
import { PonderMark } from "../../components/brand/PonderMark";
import { Button } from "../../components/ui/button";
import { toastError } from "../../components/ui/toast";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { api } from "../../lib/ipc";
import { appNow, todayDate } from "../../lib/plan/clock";
import { s } from "../../lib/strings";
import { briefingFacts, briefingPrompt, parseBriefing, recentSources, type BriefingInput } from "../../lib/tts/briefing";
import { speak, stopSpeaking, usePlayer } from "../../lib/tts/player";
import { useSpeechConfig } from "./useSpeech";

const KEY = "briefing";
let cached: { facts: string; text: string } | null = null;

async function writeBriefing(): Promise<string> {
  const now = appNow();
  const [spaces, tasks, due, mistakes] = await Promise.all([api.listSpaces(), api.listPlanTasks("0000-01-01", "9999-12-31"), api.cardsDueCounts(), api.mistakesList(null)]);
  const sources = await Promise.all(spaces.map((sp) => api.listSources(sp.id)));
  const input: BriefingInput = {
    today: todayDate(),
    weekday: new Date(now).toLocaleDateString("en-US", { weekday: "long" }),
    tasks,
    due,
    mistakes,
    newSources: recentSources(spaces, sources, now),
  };
  const facts = briefingFacts(input);
  if (!facts.length) return s.speech.briefing.nothing;
  const key = `${input.today}\n${facts.join("\n")}`;
  if (cached?.facts === key) return cached.text;
  const llm = await resolveChatModel();
  const r = await generateText({ model: llm.model, prompt: briefingPrompt(input, facts), ...llm.options({ thinking: false }) });
  const text = parseBriefing(r.text);
  if (!text) throw new Error(s.errors.generic);
  cached = { facts: key, text };
  return text;
}

export function BriefingButton() {
  const { ready } = useSpeechConfig();
  const status = usePlayer((st) => (st.key === KEY ? st.status : "idle"));
  const [writing, setWriting] = useState(false);
  if (!ready) return null;
  const busy = writing || status === "loading";
  const active = busy || status !== "idle";

  const play = async () => {
    setWriting(true);
    try {
      const text = await writeBriefing();
      setWriting(false);
      await speak(KEY, text);
    } catch (e) {
      toastError(e instanceof NoModelError ? s.chat.noModel : s.speech.briefing.failed, e, () => void play());
    } finally {
      setWriting(false);
    }
  };

  return (
    <Button
      size="lg"
      variant="secondary"
      title={s.speech.briefing.desc}
      data-testid="briefing"
      data-state={writing ? "writing" : status}
      disabled={writing}
      onClick={() => (active ? stopSpeaking() : void play())}
    >
      {busy ? <PonderMark size={20} state="generating" /> : active ? <Square size={14} /> : <Headphones size={16} />}
      {writing ? s.speech.briefing.writing : active ? s.speech.briefing.stop : s.speech.briefing.play}
    </Button>
  );
}
