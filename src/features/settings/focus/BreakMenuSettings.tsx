import { ArrowDown, ArrowUp, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { toastError } from "../../../components/ui/toast";
import { DEFAULT_BREAK_MENU, useFocusPrefs, useSetFocusPref } from "../../../lib/focusPrefs";
import { s } from "../../../lib/strings";

export const MAX_BREAK_ITEMS = 12;
export const MAX_BREAK_ITEM_LEN = 80;

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

function ItemRow({
  item,
  index,
  count,
  onCommit,
  onMove,
  onRemove,
}: {
  item: string;
  index: number;
  count: number;
  onCommit: (value: string) => boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(item);
  const commit = () => {
    if (draft.trim() === item) return setDraft(item);
    if (!onCommit(draft)) setDraft(item);
  };
  const icon = "rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <li className="flex items-center gap-1.5">
      <Input
        value={draft}
        maxLength={MAX_BREAK_ITEM_LEN}
        aria-label={s.breakMenu.editLabel(index + 1)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(item);
        }}
        className="h-9 flex-1"
      />
      <button className={icon} disabled={index === 0} aria-label={s.breakMenu.moveUp(item)} onClick={() => onMove(-1)}>
        <ArrowUp size={15} />
      </button>
      <button className={icon} disabled={index === count - 1} aria-label={s.breakMenu.moveDown(item)} onClick={() => onMove(1)}>
        <ArrowDown size={15} />
      </button>
      <button className={icon} aria-label={s.breakMenu.remove(item)} onClick={onRemove}>
        <X size={15} />
      </button>
    </li>
  );
}

export function BreakMenuSettings() {
  const { prefs } = useFocusPrefs();
  const setPref = useSetFocusPref();
  const items = prefs.breakMenu;
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState<string | null>(null);

  const save = (next: string[]) => {
    setPref("breakMenu", next).catch((e) => toastError(s.breakMenu.saveFailed, e));
  };

  const validate = (value: string, ignoreIndex?: number): string | null => {
    const v = value.trim();
    if (!v) return null;
    if (items.some((x, i) => i !== ignoreIndex && same(x, v))) {
      setHint(s.breakMenu.duplicate);
      return null;
    }
    setHint(null);
    return v;
  };

  const add = () => {
    if (items.length >= MAX_BREAK_ITEMS) return setHint(s.breakMenu.full(MAX_BREAK_ITEMS));
    const v = validate(draft);
    if (!v) return;
    save([...items, v]);
    setDraft("");
  };

  const edit = (i: number, value: string) => {
    const v = validate(value, i);
    if (!v) return false;
    save(items.map((x, j) => (j === i ? v : x)));
    return true;
  };

  const move = (i: number, dir: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    save(next);
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{s.breakMenu.title}</h3>
          <p className="mt-0.5 text-[0.8125rem] text-muted">{s.breakMenu.body}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setHint(null);
            save(DEFAULT_BREAK_MENU);
          }}
        >
          <RotateCcw size={13} /> {s.breakMenu.reset}
        </Button>
      </div>
      {items.length === 0 && <p className="mt-3 text-[0.8125rem] text-faint">{s.breakMenu.empty}</p>}
      <ul className="mt-3 space-y-1.5">
        {items.map((item, i) => (
          <ItemRow
            key={`${i}:${item}`}
            item={item}
            index={i}
            count={items.length}
            onCommit={(v) => edit(i, v)}
            onMove={(d) => move(i, d)}
            onRemove={() => save(items.filter((_, j) => j !== i))}
          />
        ))}
      </ul>
      <Input
        value={draft}
        maxLength={MAX_BREAK_ITEM_LEN}
        aria-label={s.breakMenu.addLabel}
        placeholder={s.breakMenu.addPlaceholder}
        onChange={(e) => {
          setDraft(e.target.value);
          setHint(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && add()}
        className="mt-2 h-9"
      />
      {hint && (
        <p role="status" className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
