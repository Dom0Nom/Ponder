import { useState } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { api } from "../../lib/ipc";
import { storedControls } from "../../lib/chat/controls";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { runTurn } from "../../lib/chat/runner";
import { queryClient, qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Message, Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { toast, toastError } from "../../components/ui/toast";
import { useFocusStore } from "../focus/focusStore";
import { actionIconBtn } from "./actionButton";

export function RetryButton({ message, space, subtle }: { message: Message; space: Space; subtle?: boolean }) {
  const [busy, setBusy] = useState(false);
  const navigate = useUi((st) => st.navigate);
  const retry = async () => {
    setBusy(true);
    try {
      const all = await api.listMessages(message.threadId);
      const idx = all.findIndex((m) => m.id === message.id);
      const prevUser = [...all.slice(0, idx)].reverse().find((m) => m.role === "user");
      const seconds = all.slice(idx + 1).filter((m) => m.meta?.secondOpinionOf === message.id);
      const after = all.slice(idx + 1).filter((m) => m.meta?.secondOpinionOf !== message.id);
      if (after.length) {
        toast.info(s.chat.onlyLatest);
        return;
      }
      const llm = await resolveChatModel(space);
      for (const m of seconds) await api.deleteMessage(m.id);
      await api.deleteMessage(message.id);
      queryClient.invalidateQueries({ queryKey: qk.messages(message.threadId) });
      await runTurn({
        llm,
        space,
        threadId: message.threadId,
        tutorStyle: space.tutorStyle,
        controls: storedControls(llm),
        focus: useFocusStore.getState().state,
        userText: prevUser?.content,
        query: prevUser?.content,
        persistUser: false,
      });
    } catch (e) {
      if (e instanceof NoModelError) {
        toast.error(s.chat.noModel, { action: { label: s.chat.noModelAction, onClick: () => navigate({ name: "settings" }) } });
      } else toastError(s.chat.failed, e);
    } finally {
      setBusy(false);
    }
  };
  if (subtle)
    return (
      <button
        aria-label={s.chat.regenerate}
        data-tip-name={s.chat.regenerate}
        data-tip-desc={s.chat.regenerateDesc(message.meta?.model?.model ?? "")}
        disabled={busy}
        onClick={retry}
        className={actionIconBtn}
      >
        <RefreshCw size={14} />
      </button>
    );
  return (
    <button
      aria-label={s.common.retry}
      disabled={busy}
      onClick={retry}
      className={cn("inline-flex h-7 shrink-0 items-center gap-1 rounded-btn border border-control px-2.5 text-label font-medium hover:bg-fill")}
    >
      <RotateCcw size={13} /> {s.common.retry}
    </button>
  );
}
