import { useState, type ReactNode } from "react";
import type { Card } from "../../lib/types";
import { clozeBack, clozeFront } from "../../lib/srs/cloze";
import { ChoiceOption } from "../../components/ui/choice";
import { Markdown } from "../chat/Markdown";
import { OcclusionSlot } from "./occlusionSlot";

const FRONT = "px-12 pb-9 pt-11 text-center text-[1.375rem] font-medium leading-[1.4] [text-wrap:balance] [&_p]:m-0";
const BACK =
  "border-t border-divider px-12 py-7 text-center text-title leading-[1.55] text-fg-secondary [text-wrap:balance] [&_p]:m-0";

function Back({ children }: { children: ReactNode }) {
  return <div className={BACK}>{children}</div>;
}

/** Question and answer side of any card type. MCQ answers are picked on the card itself. */
export function CardFace({
  card,
  revealed,
  onPick,
}: {
  card: Card;
  revealed: boolean;
  onPick?: (correct: boolean) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  if (card.kind === "occlusion")
    return (
      <div className="p-6">
        <OcclusionSlot card={card} revealed={revealed} />
      </div>
    );
  if (card.kind === "cloze") {
    const n = card.data?.cloze ?? 1;
    return (
      <div data-testid="card-face">
        <div className="px-12 pb-9 pt-11 text-center text-[1.125rem] leading-[1.55] [text-wrap:pretty] [&_p]:m-0">
          <Markdown text={revealed ? clozeBack(card.front, n) : clozeFront(card.front, n)} />
        </div>
        {revealed && card.back && (
          <Back>
            <Markdown text={card.back} />
          </Back>
        )}
      </div>
    );
  }
  if (card.kind === "mcq" && card.data?.options) {
    const answer = card.data.answer ?? 0;
    const show = revealed || picked != null;
    return (
      <div data-testid="card-face">
        <div className={FRONT}>
          <Markdown text={card.front} />
        </div>
        <div className="flex flex-col gap-2 px-12 pb-6" role="radiogroup" aria-label={card.front}>
          {card.data.options.map((o, i) => (
            <ChoiceOption
              key={i}
              label={o}
              selected={picked === i}
              state={show && i === answer ? "correct" : show && i === picked ? "wrong" : "idle"}
              disabled={show}
              onClick={() => {
                setPicked(i);
                onPick?.(i === answer);
              }}
            />
          ))}
        </div>
        {revealed && card.back && (
          <Back>
            <Markdown text={card.back} />
          </Back>
        )}
      </div>
    );
  }
  return (
    <div data-testid="card-face">
      <div className={FRONT}>
        <Markdown text={card.front} />
      </div>
      {revealed && (
        <Back>
          <Markdown text={card.back} />
        </Back>
      )}
    </div>
  );
}
