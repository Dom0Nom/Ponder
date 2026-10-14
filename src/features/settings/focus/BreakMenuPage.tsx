import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useRef, useState } from "react";
import { Reveal } from "../../../components/motion/Reveal";
import { TextSwap } from "../../../components/motion/TextSwap";
import { useFlip } from "../../../lib/useFlip";
import { useFreshKeys } from "../../../lib/useFreshKeys";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Tooltip } from "../../../components/ui/misc";
import { toastError } from "../../../components/ui/toast";
import { DEFAULT_BREAK_MENU, useFocusPrefs, useSetFocusPref } from "../../../lib/focusPrefs";
import { s } from "../../../lib/strings";
import { useUi } from "../../../stores/ui";
import { SubPage } from "../SubPage";

export const MAX_BREAK_ITEMS = 12;
export const MAX_BREAK_ITEM_LEN = 80;

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

function ItemRow({
  item,
  index,
  count,
  fresh,
  onCommit,
  onMove,
  onRemove,
}: {
  fresh: boolean;
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
  return (
    <Reveal as="li" active={fresh} data-flip-key={item} className="flex h-[42.5px] items-center gap-1.5">
      <input
        value={draft}
        maxLength={MAX_BREAK_ITEM_LEN}
        aria-label={s.breakMenu.editLabel(index + 1)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(item);
        }}
        className="h-full min-w-0 flex-1 bg-transparent font-medium text-fg outline-none focus:underline focus:decoration-control focus:underline-offset-4"
      />
      <Tooltip content={s.breakMenu.moveUpShort}>
        <Button variant="ghost-muted" size="icon-sm" className="disabled:opacity-30" disabled={index === 0} aria-label={s.breakMenu.moveUp(item)} onClick={() => onMove(-1)}>
          <ArrowUp size={15} />
        </Button>
      </Tooltip>
      <Tooltip content={s.breakMenu.moveDownShort}>
        <Button variant="ghost-muted" size="icon-sm" className="disabled:opacity-30" disabled={index === count - 1} aria-label={s.breakMenu.moveDown(item)} onClick={() => onMove(1)}>
          <ArrowDown size={15} />
        </Button>
      </Tooltip>
      <Tooltip content={s.breakMenu.removeShort}>
        <Button variant="ghost-muted" size="icon-sm" aria-label={s.breakMenu.remove(item)} onClick={onRemove}>
          <X size={15} />
        </Button>
      </Tooltip>
    </Reveal>
  );
}

export function BreakMenuPage() {
  const navigate = useUi((st) => st.navigate);
  const { prefs } = useFocusPrefs();
  const setPref = useSetFocusPref();
  const items = prefs.breakMenu;
  const [draft, setDraft] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const isFresh = useFreshKeys(items);
  useFlip(listRef, [items]);

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
    <SubPage
      crumb={s.settings.crumbFocus}
      section="focus"
      title={s.breakMenu.title}
      description={s.breakMenu.body}
      footer={
        <>
          <span className="me-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setHint(null);
                save(DEFAULT_BREAK_MENU);
              }}
            >
              {s.breakMenu.reset}
            </Button>
          </span>
          <Button variant="primary" onClick={() => navigate({ name: "settings", section: "focus" })}>
            {s.common.done}
          </Button>
        </>
      }
    >
      <ul ref={listRef} className="relative rounded-card border border-border ps-3.5 pe-2 [&>*+*]:border-t [&>*+*]:border-divider">
        {items.length === 0 && <li className="py-3 text-body text-faint">{s.breakMenu.empty}</li>}
        {items.map((item, i) => (
          <ItemRow
            key={item}
            fresh={isFresh(item)}
            item={item}
            index={i}
            count={items.length}
            onCommit={(v) => edit(i, v)}
            onMove={(d) => move(i, d)}
            onRemove={() => save(items.filter((_, j) => j !== i))}
          />
        ))}
      </ul>
      <div>
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
        />
        {hint && (
          <p role="status" className="mt-1.5 text-caption text-muted">
            <TextSwap text={hint} />
          </p>
        )}
      </div>
    </SubPage>
  );
}
