import { useState } from "react";
import { Check, SkipForward, X } from "lucide-react";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/input";
import { toastError } from "../../components/ui/toast";
import { Reveal } from "../../components/motion/Reveal";
import { SuccessCircleCheck } from "../../components/motion/SuccessCheck";
import { useUi } from "../../stores/ui";
import { blockLabel } from "./blockLabel";
import { useSession } from "./sessionStore";

/** Floating strip that follows a Next session across screens. */
export function SessionBar() {
  const active = useSession((st) => st.active);
  const finished = useSession((st) => st.finished);
  const { complete, skip, end } = useSession.getState();
  const navigate = useUi((st) => st.navigate);
  const [note, setNote] = useState("");

  if (finished != null)
    return (
      <div className="fixed bottom-5 start-1/2 z-40 -translate-x-1/2" data-testid="session-finished">
        <Reveal className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 shadow-lg">
          <SuccessCircleCheck size={18} />
          <div>
            <p className="font-semibold">{s.session.finished}</p>
            <p className="text-label text-muted">{s.session.finishedBody(finished)}</p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              end();
              navigate({ name: "home" });
            }}
          >
            {s.session.back}
          </Button>
        </Reveal>
      </div>
    );
  if (!active) return null;

  const block = active.blocks[active.index];
  const reflect = block.kind === "reflect";
  const last = active.index === active.blocks.length - 1;

  const finish = async () => {
    if (reflect && note.trim()) {
      try {
        await api.addJournal(active.spaceId, "reflection", s.session.kinds.reflect, note.trim());
      } catch (e) {
        toastError(s.errors.generic, e);
        return;
      }
    }
    setNote("");
    complete();
  };

  return (
    <div className="fixed bottom-5 start-1/2 z-40 w-[min(560px,calc(100vw-48px))] -translate-x-1/2" data-testid="session-bar" role="region" aria-label={s.session.title}>
      <div key={block.id} className="t-page-enter flex flex-col gap-3 rounded-card border border-border bg-surface px-4 py-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-label text-muted tabular-nums">{s.session.blockOf(active.index + 1, active.blocks.length)}</p>
            <p className="truncate font-semibold" data-testid="session-block">
              {blockLabel(block)}
            </p>
          </div>
          {!reflect && (
            <Button size="sm" variant="ghost" onClick={skip}>
              <SkipForward size={14} />
              {s.session.skip}
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={finish} data-testid="session-done">
            <Check size={14} />
            {last ? s.session.finish : s.session.markDone}
          </Button>
          <Button size="icon-sm" variant="ghost-muted" aria-label={s.common.close} onClick={end}>
            <X size={14} />
          </Button>
        </div>
        {reflect && (
          <label className="flex flex-col gap-1.5">
            <span className="text-body text-fg-secondary">{s.session.reflectPrompt}</span>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={s.session.reflectPlaceholder} rows={2} />
          </label>
        )}
      </div>
    </div>
  );
}
