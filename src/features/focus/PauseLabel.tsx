import { Pause, Play } from "lucide-react";
import { TextSwap } from "../../components/motion/TextSwap";
import { s } from "../../lib/strings";

/** Pause/Resume content: icon swap plus label swap. */
export function PauseLabel({ paused, size = 15 }: { paused: boolean; size?: number }) {
  return (
    <>
      <span className="t-icon-swap" data-state={paused ? "b" : "a"}>
        <Pause size={size} data-icon="a" className="t-icon" />
        <Play size={size} data-icon="b" className="t-icon" />
      </span>
      <TextSwap text={paused ? s.focus.resume : s.focus.pause} />
    </>
  );
}
