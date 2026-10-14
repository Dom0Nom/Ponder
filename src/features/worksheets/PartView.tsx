import { Fragment } from "react";
import { QuestionView } from "../../components/questions/QuestionView";
import { SuccessCheck } from "../../components/motion/SuccessCheck";
import { Input, Textarea } from "../../components/ui/input";
import { Markdown } from "../chat/Markdown";
import { fillMatches } from "../../lib/questions/grade";
import { openKey, partCredit } from "../../lib/worksheets/grade";
import { optionLabel, sheetLabels } from "../../lib/worksheets/labels";
import type { Attempt, Part, PartResponse, Task, LabelStyle } from "../../lib/worksheets/types";
import { s } from "../../lib/strings";
import { cn } from "../../lib/utils";
import { X } from "lucide-react";

interface Props {
  task: Task;
  pi: number;
  value: PartResponse | null | undefined;
  onChange: (r: PartResponse) => void;
  reveal: boolean;
  disabled?: boolean;
  labelStyle: LabelStyle;
  language: string;
  open: Attempt["open"];
}

function Gap({ value, accepted, reveal, onChange, label, disabled }: { value: string; accepted: string[]; reveal: boolean; onChange: (v: string) => void; label: string; disabled?: boolean }) {
  const right = fillMatches(accepted, value);
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <Input
        value={value}
        aria-label={label}
        disabled={disabled}
        data-testid="gap-input"
        onChange={(e) => onChange(e.target.value)}
        className={cn("mx-1 inline-block h-8 w-32", reveal && (right ? "border-success" : "border-danger"))}
      />
      {reveal && (right ? <SuccessCheck size={14} /> : <span className="text-label text-fg-secondary">{accepted[0]}</span>)}
    </span>
  );
}

export function PartView({ task, pi, value, onChange, reveal, disabled, labelStyle, language, open }: Props) {
  const part: Part = task.parts[pi];
  const l = sheetLabels(language);
  if (part.kind === "cloze") {
    const texts = value?.kind === "cloze" ? value.texts : [];
    const set = (i: number, v: string) => onChange({ kind: "cloze", texts: part.blanks.map((_, k) => (k === i ? v : (texts[k] ?? ""))) });
    return (
      <div className="flex flex-col gap-2" data-testid="cloze">
        {task.bank && task.bank.length > 0 && (
          <p className="rounded-card border border-border bg-fill-faint px-3 py-2 text-body" data-testid="word-bank">
            <span className="me-2 font-semibold">{l.wordBank}:</span>
            {[...task.bank].sort((a, b) => a.localeCompare(b)).join(" · ")}
          </p>
        )}
        <p className="leading-10">
          {part.text.split(/(\{\d+\})/).map((seg, i) => {
            const m = seg.match(/^\{(\d+)\}$/);
            if (!m) return <Fragment key={i}>{seg}</Fragment>;
            const bi = Number(m[1]) - 1;
            const b = part.blanks[bi];
            return b ? <Gap key={i} value={texts[bi] ?? ""} accepted={b.accepted} reveal={reveal} disabled={disabled} label={s.questions.blank(bi + 1)} onChange={(v) => set(bi, v)} /> : null;
          })}
        </p>
      </div>
    );
  }
  if (part.kind === "tablefill") {
    const texts = value?.kind === "tablefill" ? value.texts : [];
    let gap = 0;
    return (
      <div className="overflow-x-auto" data-testid="tablefill">
        <table className="border-collapse text-body">
          <thead>
            <tr>
              {part.columns.map((c, i) => (
                <th key={i} className="border border-border bg-fill-subtle px-2.5 py-1.5 text-start font-semibold">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {part.rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => {
                  if (c !== "") return <td key={ci} className="border border-border px-2.5 py-1.5">{c}</td>;
                  const bi = gap++;
                  const b = part.blanks[bi];
                  return (
                    <td key={ci} className="border border-border p-1">
                      <Gap
                        value={texts[bi] ?? ""}
                        accepted={b?.accepted ?? []}
                        reveal={reveal}
                        disabled={disabled}
                        label={s.questions.blank(bi + 1)}
                        onChange={(v) => onChange({ kind: "tablefill", texts: part.blanks.map((_, k) => (k === bi ? v : (texts[k] ?? ""))) })}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (part.kind === "open") {
    const text = value?.kind === "open" ? value.text : "";
    const g = open[openKey(task.id, pi)];
    return (
      <div className="flex flex-col gap-2" data-testid="open-part">
        <div className="font-medium">
          <Markdown text={part.prompt} />
        </div>
        {(part.operator || part.level) && (
          <p className="text-label text-muted">
            {[part.operator, part.level ? l.levels[part.level] : null].filter(Boolean).join(" · ")}
          </p>
        )}
        <Textarea
          value={text}
          rows={Math.min(8, Math.max(3, part.lines))}
          disabled={disabled}
          aria-label={part.prompt}
          onChange={(e) => onChange({ kind: "open", text: e.target.value })}
        />
        {reveal && (
          <div className="flex flex-col gap-1 rounded-card border border-border bg-fill-faint px-3 py-2.5 text-body" data-testid="open-feedback">
            {g ? (
              <p className="font-semibold">
                {s.questions.partial(String(g.points), String(g.max))}
                {g.reason && <span className="ms-2 font-normal text-fg-secondary">{g.reason}</span>}
              </p>
            ) : (
              <p className="text-muted">{s.worksheets.notGradedYet}</p>
            )}
            <p className="text-fg-secondary">
              <span className="font-semibold">{l.key}: </span>
              {part.key}
            </p>
          </div>
        )}
      </div>
    );
  }
  const credit = partCredit(task, pi, value, open);
  return (
    <div className="flex flex-col gap-1.5">
      <QuestionView
        q={part}
        value={value && value.kind !== "cloze" && value.kind !== "tablefill" && value.kind !== "open" ? value : null}
        onChange={onChange}
        reveal={reveal}
        disabled={disabled}
        optionLabel={labelStyle === "box" ? undefined : (i) => optionLabel(labelStyle, i)}
      />
      {reveal && credit.credit > 0 && credit.credit < 1 && (
        <p className="flex items-center gap-1.5 text-label text-fg-secondary">
          <X size={12} className="text-danger" />
          {s.worksheets.partialCredit(Math.round(credit.credit * 100))}
        </p>
      )}
      {reveal && part.explanation && <p className="text-label text-fg-secondary">{part.explanation}</p>}
    </div>
  );
}
