import { useRef, useState } from "react";
import { ArrowUp, Brain, Square } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { runTurn } from "../../lib/chat/runner";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { useUpdateSpace } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Space, Thread, TutorStyle } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { useChatStream } from "../../stores/chatStream";
import { useFocusStore } from "../focus/focusStore";
import { Segmented, Tooltip } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";

export function Composer({
  space,
  thread,
  ensureThread,
  hasSources,
}: {
  space: Space;
  thread?: Thread;
  ensureThread: () => Promise<Thread>;
  hasSources: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const thinking = useUi((st) => st.thinking);
  const setThinking = useUi((st) => st.setThinking);
  const navigate = useUi((st) => st.navigate);
  const running = useChatStream((st) => (thread ? st.running[thread.id] : undefined));
  const stop = useChatStream((st) => st.stop);
  const update = useUpdateSpace();
  useQueryClient();

  const send = async (override?: string) => {
    const msg = (override ?? text).trim();
    if (!msg || busy || running) return;
    setBusy(true);
    try {
      const llm = await resolveChatModel(space);
      const t = thread ?? (await ensureThread());
      setText("");
      await runTurn({
        llm,
        space,
        threadId: t.id,
        tutorStyle: space.tutorStyle,
        thinking,
        focus: useFocusStore.getState().state,
        userText: msg,
      });
    } catch (e) {
      if (e instanceof NoModelError) {
        setText(msg);
        toast.error(s.chat.noModel, {
          action: { label: s.chat.noModelAction, onClick: () => navigate({ name: "settings" }) },
        });
      } else {
        toastError(s.chat.failed, e);
      }
    } finally {
      setBusy(false);
      ref.current?.focus();
    }
  };

  const disabled = busy || !!running;

  return (
    <div className="rounded-[24px] border border-border bg-surface shadow-card transition-colors focus-within:border-accent">
      <textarea
        ref={ref}
        rows={1}
        value={text}
        aria-label={s.chat.placeholder}
        placeholder={hasSources ? s.chat.placeholder : s.chat.emptyNoSources}
        onChange={(e) => {
          setText(e.target.value);
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        className="block max-h-[220px] w-full resize-none bg-transparent px-5 pb-1 pt-3.5 text-[0.9375rem] leading-relaxed outline-none placeholder:text-faint"
      />
      <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
        <Segmented<TutorStyle>
          size="sm"
          label={s.space.tutorStyle}
          value={space.tutorStyle}
          onChange={(v) =>
            update.mutate({ id: space.id, patch: { tutorStyle: v } }, { onError: (e) => toastError(s.errors.generic, e) })
          }
          options={(["direct", "socratic", "mixed"] as const).map((v) => ({
            value: v,
            label: s.space.tutorStyles[v],
            title: s.space.tutorStyleHelp[v],
          }))}
        />
        <Tooltip content={thinking ? "Thinking on: slower, more careful answers" : "Thinking off: faster answers"}>
          <button
            role="switch"
            aria-checked={thinking}
            aria-label={s.chat.thinkingToggle}
            onClick={() => setThinking(!thinking)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
              thinking ? "border-transparent bg-accent-soft text-accent-text" : "border-border text-muted hover:text-fg",
            )}
          >
            <Brain size={14} /> {s.chat.thinkingToggle}
          </button>
        </Tooltip>
        <div className="ml-auto">
          {running ? (
            <button
              aria-label={s.chat.stop}
              onClick={() => thread && stop(thread.id)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-fg text-bg"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              aria-label={s.chat.send}
              disabled={disabled || !text.trim()}
              onClick={() => send()}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-on-accent transition-opacity disabled:opacity-30"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
