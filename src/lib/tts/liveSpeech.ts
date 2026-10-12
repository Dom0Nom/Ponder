import { plainAnswer } from "../chat/plainAnswer";
import { stripMarkers } from "../chat/followUps";
import { speakable } from "./speech";

const clean = (content: string) => plainAnswer(stripMarkers(content)).replace(/\n{3,}/g, "\n\n");

/** End of the last finished line or sentence at or after `from`, outside code fences; -1 when there is none yet. */
export function speechCut(text: string, from: number): number {
  let cut = -1;
  const re = /\n|[.!?…]["')\]]*(?=\s)/g;
  re.lastIndex = from;
  for (let m = re.exec(text); m; m = re.exec(text)) cut = m.index + m[0].length;
  if (cut < 0) return -1;
  const fences = text.slice(0, cut).split("```").length - 1;
  if (fences % 2) {
    const open = text.lastIndexOf("```", cut - 3);
    return open > from ? open : -1;
  }
  return cut;
}

/** Feeds a reply that is still streaming to speech one finished sentence at a time. */
export class LiveSpeech {
  private done = 0;
  constructor(private readonly say: (text: string) => void) {}

  update(content: string) {
    const text = clean(content);
    const cut = speechCut(text, this.done);
    if (cut > this.done) this.emit(text, cut);
  }

  /** The finished reply: speaks whatever hasn't been spoken yet. */
  finish(content: string) {
    const text = clean(content);
    if (text.length > this.done) this.emit(text, text.length);
  }

  private emit(text: string, cut: number) {
    const part = speakable(text.slice(this.done, cut));
    this.done = cut;
    if (part.trim()) this.say(part);
  }
}
