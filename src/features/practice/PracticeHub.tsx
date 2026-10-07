import { useState } from "react";
import { LearnChevron } from "../../components/motion/LearnChevron";
import { s } from "../../lib/strings";
import type { Ability } from "../../lib/types";
import { skillPercent } from "../../lib/practice/irt";
import type { TopicSpec } from "../../lib/practice/problems";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ErrorPatterns } from "./ErrorPatterns";

export function PracticeHub({
  spaceId,
  topics,
  abilityByKey,
  onPick,
}: {
  spaceId: string;
  topics: TopicSpec[];
  abilityByKey: Map<string, Ability>;
  onPick: (key: string) => void;
}) {
  const [free, setFree] = useState("");
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1040px] flex-col gap-5 px-10 pb-12 pt-10">
        <h1 className="text-page font-semibold">{s.practice.title}</h1>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (free.trim()) onPick(`free:${free.trim().slice(0, 80)}`);
          }}
        >
          <Input
            value={free}
            onChange={(e) => setFree(e.target.value)}
            placeholder={s.practice.freePlaceholder}
            aria-label={s.practice.freePlaceholder}
            className="flex-1"
          />
          <Button type="submit" disabled={!free.trim()}>
            {s.practice.go}
          </Button>
        </form>
        <div className="mt-2 grid grid-cols-[minmax(0,1fr)_260px] gap-8">
          <section className="flex flex-col gap-2.5">
            <h2 className="text-title font-semibold">{s.practice.pickTitle}</h2>
            <p className="text-body leading-[1.5] text-muted [text-wrap:pretty]">{s.practice.pickBody}</p>
            {topics.length === 0 && <p className="text-body text-muted">{s.practice.noTopics}</p>}
            <ul className="flex flex-col gap-2.5" data-testid="practice-topics">
              {topics.map((t) => {
                const a = abilityByKey.get(t.key);
                return (
                  <li key={t.key}>
                    <button
                      onClick={() => onPick(t.key)}
                      className="t-learn flex w-full items-center gap-3.5 rounded-card border border-border px-4 py-[13px] text-left hover:bg-fill-faint"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-input font-semibold">{t.title}</p>
                        <p className="text-caption text-muted">
                          {a ? s.practice.skill(skillPercent(a.theta), a.n) : s.practice.notPractised}
                        </p>
                      </div>
                      <span className="shrink-0"><LearnChevron size={15} /></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
          <ErrorPatterns spaceId={spaceId} />
        </div>
      </div>
    </div>
  );
}
