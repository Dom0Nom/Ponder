import { useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Markdown } from "../../features/chat/Markdown";
import { NativeSelect } from "../../features/settings/NativeSelect";
import { gradeQuestion } from "../../lib/questions/grade";
import { scrambleOrder } from "../../lib/questions/parse";
import type { DragQuestion, DropdownQuestion, FillQuestion, HotspotQuestion, McQuestion, MultiQuestion, Question, Response } from "../../lib/questions/types";
import { s } from "../../lib/strings";
import { cn } from "../../lib/utils";
import { SuccessCheck } from "../motion/SuccessCheck";
import { useShake } from "../motion/useShake";
import { Checkbox16 } from "../ui/checkbox";
import { ChoiceOption } from "../ui/choice";
import { Input } from "../ui/input";
import { Stimulus } from "./Stimulus";

export interface KindProps<Q extends Question> {
  q: Q;
  value: Response | null | undefined;
  onChange: (r: Response) => void;
  /** show right and wrong (after checking) */
  reveal?: boolean;
  disabled?: boolean;
  /** prefix for choice options (a), A., 1., ☐) */
  optionLabel?: (i: number) => string;
}

function OptionText({ text, label }: { text: string; label?: string }) {
  return (
    <span className="flex gap-2">
      {label && <span className="text-muted">{label}</span>}
      <span className="min-w-0 flex-1">
        <Markdown text={text} />
      </span>
    </span>
  );
}

function ChoiceMc({ q, value, onChange, reveal, disabled, optionLabel }: KindProps<McQuestion>) {
  const choice = value?.kind === "mc" ? value.choice : -1;
  return (
    <div role="radiogroup" aria-label={q.prompt} className="flex flex-col gap-2">
      {q.options.map((o, k) => (
        <ChoiceOption
          key={k}
          label={<OptionText text={o} label={optionLabel?.(k)} />}
          selected={choice === k}
          disabled={disabled}
          state={reveal ? (k === q.answer ? "correct" : choice === k ? "wrong" : "idle") : "idle"}
          onClick={() => onChange({ kind: "mc", choice: k })}
        />
      ))}
    </div>
  );
}

function ChoiceMulti({ q, value, onChange, reveal, disabled, optionLabel }: KindProps<MultiQuestion>) {
  const picked = value?.kind === "multi" ? value.choices : [];
  const toggle = (k: number) => onChange({ kind: "multi", choices: picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k].sort((a, b) => a - b) });
  return (
    <fieldset className="flex flex-col gap-2" data-testid="multi-options">
      <legend className="pb-1 text-label text-muted">{s.questions.selectAll}</legend>
      {q.options.map((o, k) => {
        const right = q.answers.includes(k);
        const on = picked.includes(k);
        return (
          <label
            key={k}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-3 rounded-tile border px-3.5 py-2.5 text-input font-medium transition-colors",
              reveal && right ? "border-success bg-success-soft" : reveal && on ? "border-danger bg-danger-soft" : on ? "border-fg bg-fill-subtle" : "border-control hover:bg-fill-faint",
            )}
          >
            <Checkbox16 checked={on} disabled={disabled} onChange={() => toggle(k)} />
            <span className="min-w-0 flex-1">
              <OptionText text={o} label={optionLabel?.(k)} />
            </span>
            {reveal && right && <SuccessCheck size={16} />}
            {reveal && !right && on && <X size={16} className="text-danger" />}
          </label>
        );
      })}
    </fieldset>
  );
}

function Fill({ q, value, onChange, reveal, disabled }: KindProps<FillQuestion>) {
  const text = value?.kind === "fill" ? value.text : "";
  const g = gradeQuestion(q, value);
  const shake = useShake();
  const wrong = !!reveal && !g.correct;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Input
          value={text}
          disabled={disabled}
          inputMode={q.numeric ? "decimal" : undefined}
          aria-label={s.questions.yourAnswer}
          placeholder={s.questions.yourAnswer}
          data-testid="fill-input"
          className={cn("max-w-xs", shake.cls(wrong), reveal && g.correct && "border-success")}
          onChange={(e) => onChange({ kind: "fill", text: e.target.value })}
          onAnimationEnd={shake.props.onAnimationEnd}
        />
        {reveal && g.correct && (
          <span className="text-success">
            <SuccessCheck size={16} />
          </span>
        )}
      </div>
      {wrong && <p className="text-label text-fg-secondary">{s.questions.answerWas(q.accepted[0] ?? "")}</p>}
    </div>
  );
}

function Dropdown({ q, value, onChange, reveal, disabled }: KindProps<DropdownQuestion>) {
  const picks = value?.kind === "dropdown" ? value.picks : q.blanks.map(() => null);
  const parts = q.text.split(/(\{\d+\})/);
  return (
    <p className="leading-9" data-testid="dropdown-text">
      {parts.map((part, i) => {
        const m = part.match(/^\{(\d+)\}$/);
        if (!m) return <span key={i}>{part}</span>;
        const bi = Number(m[1]) - 1;
        const b = q.blanks[bi];
        if (!b) return null;
        const state = reveal ? (picks[bi] === b.answer ? "border-success" : "border-danger") : "";
        return (
          <NativeSelect
            key={i}
            aria-label={s.questions.blank(bi + 1)}
            disabled={disabled}
            value={picks[bi] ?? ""}
            className={cn("mx-1 inline-block w-auto min-w-28 align-middle", state)}
            onChange={(e) => onChange({ kind: "dropdown", picks: picks.map((p, k) => (k === bi ? (e.target.value === "" ? null : Number(e.target.value)) : p)) })}
          >
            <option value="">{s.questions.choose}</option>
            {b.options.map((o, k) => (
              <option key={k} value={k}>
                {o}
              </option>
            ))}
          </NativeSelect>
        );
      })}
    </p>
  );
}

function Order({ q, value, onChange, reveal, disabled }: KindProps<DragQuestion>) {
  const order = value?.kind === "drag" && value.order ? value.order : scrambleOrder(q);
  const [held, setHeld] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    onChange({ kind: "drag", order: next });
  };
  return (
    <ol className="flex flex-col gap-2" data-testid="drag-order" aria-label={s.questions.dragHint}>
      {order.map((item, pos) => {
        const right = reveal && q.correctOrder?.[pos] === item;
        return (
          <li
            key={item}
            draggable={!disabled}
            onDragStart={(e) => (e.dataTransfer.setData("text/plain", String(pos)), setHeld(pos))}
            onDragOver={(e) => (e.preventDefault(), setOver(pos))}
            onDragEnd={() => (setHeld(null), setOver(null))}
            onDrop={(e) => (e.preventDefault(), move(Number(e.dataTransfer.getData("text/plain")), pos), setHeld(null), setOver(null))}
            className={cn(
              "flex min-h-11 items-center gap-2 rounded-tile border bg-surface px-3 py-2 text-input font-medium",
              held === pos ? "m-drag-lift" : "m-drop-settle",
              over === pos && held !== pos && "border-fg",
              reveal ? (right ? "border-success bg-success-soft" : "border-danger bg-danger-soft") : "border-control",
            )}
          >
            <span className="w-5 text-label text-muted tabular-nums">{pos + 1}</span>
            <button
              type="button"
              disabled={disabled}
              aria-label={s.questions.moveItem(q.items[item], pos + 1)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") (e.preventDefault(), move(pos, pos - 1));
                if (e.key === "ArrowDown") (e.preventDefault(), move(pos, pos + 1));
              }}
              className="min-w-0 flex-1 cursor-grab text-start"
            >
              <Markdown text={q.items[item]} />
            </button>
            <button type="button" disabled={disabled || pos === 0} aria-label={s.questions.moveUp} onClick={() => move(pos, pos - 1)} className="px-1.5 text-muted hover:text-fg disabled:opacity-30">
              <ChevronUp size={14} />
            </button>
            <button type="button" disabled={disabled || pos === order.length - 1} aria-label={s.questions.moveDown} onClick={() => move(pos, pos + 1)} className="px-1.5 text-muted hover:text-fg disabled:opacity-30">
              <ChevronDown size={14} />
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Categorize({ q, value, onChange, reveal, disabled }: KindProps<DragQuestion>) {
  const placed = value?.kind === "drag" && value.placed ? value.placed : q.items.map(() => -1);
  const [held, setHeld] = useState<number | null>(null);
  const drop = (cat: number) => {
    if (held == null) return;
    onChange({ kind: "drag", placed: placed.map((p, i) => (i === held ? cat : p)) });
    setHeld(null);
  };
  const chip = (i: number) => {
    const right = reveal && q.correctCategory?.[i] === placed[i];
    return (
      <button
        key={i}
        type="button"
        draggable={!disabled}
        disabled={disabled}
        aria-pressed={held === i}
        data-item={i}
        onDragStart={(e) => (e.dataTransfer.setData("text/plain", String(i)), setHeld(i))}
        onClick={() => setHeld(held === i ? null : i)}
        className={cn(
          "rounded-tile border px-3 py-1.5 text-input font-medium",
          held === i ? "m-drag-lift border-fg bg-fill-subtle" : "m-drop-settle bg-surface",
          reveal ? (right ? "border-success bg-success-soft" : "border-danger bg-danger-soft") : held === i ? "" : "border-control",
        )}
      >
        {q.items[i]}
      </button>
    );
  };
  const unplaced = q.items.map((_, i) => i).filter((i) => placed[i] < 0);
  return (
    <div className="flex flex-col gap-3" data-testid="drag-categorize">
      <div className="flex min-h-11 flex-wrap gap-2 rounded-tile border border-dashed border-control p-2" aria-label={s.questions.unplaced}>
        {unplaced.length ? unplaced.map(chip) : <span className="text-label text-muted">{s.questions.allPlaced}</span>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {(q.categories ?? []).map((c, ci) => (
          <div
            key={ci}
            role="group"
            aria-label={c}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => (e.preventDefault(), onChange({ kind: "drag", placed: placed.map((p, i) => (i === Number(e.dataTransfer.getData("text/plain")) ? ci : p)) }), setHeld(null))}
            className="flex min-h-20 flex-col gap-2 rounded-tile border border-control p-2"
          >
            <button type="button" data-category={ci} disabled={disabled || held == null} onClick={() => drop(ci)} className="text-start text-label font-semibold text-fg-secondary enabled:hover:text-fg">
              {c}
              {held != null && <span className="ms-1.5 font-normal text-muted">{s.questions.dropHere}</span>}
            </button>
            <div className="flex flex-wrap gap-2">{q.items.map((_, i) => (placed[i] === ci ? chip(i) : null))}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Hotspot({ q, value, onChange, reveal, disabled }: KindProps<HotspotQuestion>) {
  const picked = value?.kind === "hotspot" ? value : null;
  const g = gradeQuestion(q, value);
  return (
    <div className="flex flex-col gap-2" data-testid="hotspot">
      {!reveal && <p className="text-label text-muted">{s.questions.hotspotHint}</p>}
      {q.stimulus && <Stimulus data={q.stimulus} picked={picked} reveal={reveal ? q.region : null} onPick={disabled ? undefined : (p) => onChange({ kind: "hotspot", ...p })} />}
      {reveal && (
        <p className={cn("flex items-center gap-1.5 text-label", g.correct ? "text-success" : "text-danger")}>
          {g.correct ? <SuccessCheck size={14} /> : <X size={14} />}
          {g.correct ? s.questions.hit : s.questions.miss}
        </p>
      )}
    </div>
  );
}

/** One renderer per kind behind a single entry; `Stimulus` is rendered above the prompt for kinds that don't use it as the answer area. */
export function QuestionView(props: KindProps<Question>) {
  const { q } = props;
  return (
    <div className="flex flex-col gap-3" data-testid="question" data-kind={q.kind}>
      {q.stimulus && q.kind !== "hotspot" && <Stimulus data={q.stimulus} />}
      {q.kind !== "dropdown" && (
        <div className="font-medium">
          <Markdown text={q.prompt} />
        </div>
      )}
      {q.kind === "mc" && <ChoiceMc {...props} q={q} />}
      {q.kind === "multi" && <ChoiceMulti {...props} q={q} />}
      {q.kind === "fill" && <Fill {...props} q={q} />}
      {q.kind === "dropdown" && (
        <>
          <p className="font-medium">{q.prompt}</p>
          <Dropdown {...props} q={q} />
        </>
      )}
      {q.kind === "drag" && (q.mode === "order" ? <Order {...props} q={q} /> : <Categorize {...props} q={q} />)}
      {q.kind === "hotspot" && <Hotspot {...props} q={q} />}
    </div>
  );
}
