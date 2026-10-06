import { useState } from "react";
import { Check, X } from "lucide-react";
import type { Card } from "../../lib/types";
import { cn } from "../../lib/utils";
import { clozeBack, clozeFront } from "../../lib/srs/cloze";
import { Markdown } from "../chat/Markdown";
import { OcclusionSlot } from "./occlusionSlot";

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
  if (card.kind === "occlusion") return <OcclusionSlot card={card} revealed={revealed} />;
  if (card.kind === "cloze") {
    const n = card.data?.cloze ?? 1;
    return (
      <div className="text-[1.0625rem] leading-relaxed" data-testid="card-face">
        <Markdown text={revealed ? clozeBack(card.front, n) : clozeFront(card.front, n)} />
        {revealed && card.back && <div className="mt-4 border-t border-border pt-3 text-sm text-muted"><Markdown text={card.back} /></div>}
      </div>
    );
  }
  if (card.kind === "mcq" && card.data?.options) {
    const answer = card.data.answer ?? 0;
    return (
      <div data-testid="card-face">
        <div className="text-[1.0625rem] font-medium leading-relaxed">
          <Markdown text={card.front} />
        </div>
        <div className="mt-4 space-y-2">
          {card.data.options.map((o, i) => {
            const show = revealed || picked != null;
            return (
              <button
                key={i}
                disabled={show}
                onClick={() => {
                  setPicked(i);
                  onPick?.(i === answer);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-2xl border px-4 py-2.5 text-left text-sm",
                  show && i === answer ? "border-success bg-success/10" : show && i === picked ? "border-danger bg-danger-soft" : "border-border hover:bg-surface-2",
                )}
              >
                <span className="flex-1">{o}</span>
                {show && i === answer && <Check size={15} className="text-success" />}
                {show && i === picked && i !== answer && <X size={15} className="text-danger" />}
              </button>
            );
          })}
        </div>
        {revealed && card.back && <div className="mt-3 text-sm text-muted"><Markdown text={card.back} /></div>}
      </div>
    );
  }
  return (
    <div data-testid="card-face">
      <div className="text-[1.0625rem] font-medium leading-relaxed">
        <Markdown text={card.front} />
      </div>
      {revealed && (
        <div className="mt-5 border-t border-border pt-4 text-[0.9375rem] leading-relaxed">
          <Markdown text={card.back} />
        </div>
      )}
    </div>
  );
}
