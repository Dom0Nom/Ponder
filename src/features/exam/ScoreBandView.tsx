import { NumberPop } from "../../components/motion/NumberPop";
import { TextSwap } from "../../components/motion/TextSwap";
import type { ScoreBand } from "../../lib/exam/band";
import type { ExamFormat } from "../../lib/exam/formats";
import { s } from "../../lib/strings";

export const tierText = (id: string | undefined) => (id ? (s.scoreBand.tier as Record<string, string>)[id] : s.scoreBand.tier.below);

export function ScoreBandView({ band, format, attempts }: { band: ScoreBand; format: ExamFormat; attempts: number }) {
  const range = s.scoreBand.range(band.low, band.high);
  return (
    <div className="flex flex-col gap-0.5" data-testid="score-band">
      <span className="text-title font-semibold tabular-nums" data-testid="score-band-range">
        <NumberPop text={range} popKey={range} onMount />
      </span>
      {format.tiers && (
        <TextSwap text={tierText(band.tier?.id)} className="text-label font-semibold" />
      )}
      <span className="text-label text-muted" data-testid="score-band-note">
        {format.officialPractice ? s.scoreBand.estimateOfficial(format.officialPractice) : s.scoreBand.estimate} {s.scoreBand.basedOn(attempts)}
        {band.straddles ? ` ${s.scoreBand.straddles}` : ""}
      </span>
    </div>
  );
}
