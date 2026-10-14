import { useEffect, useRef, useState } from "react";
import { ArrowUp, Camera, ChevronDown, FileUp, Library, Plus, Square } from "lucide-react";
import { storedControls } from "../../lib/chat/controls";
import { runTurn, TurnBusyError } from "../../lib/chat/runner";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { useUpdateSpace } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Space, Thread, TutorStyle } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { useChatStream } from "../../stores/chatStream";
import { useComposer } from "../../stores/composer";
import { useDrafts } from "../../stores/drafts";
import { useFocusStore } from "../focus/focusStore";
import { useLowEnergy } from "../focus/useLowEnergy";
import { PhotoDialog } from "../steps/PhotoDialog";
import { Menu, MenuContent, MenuItem, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../../components/ui/menu";
import { Tooltip } from "../../components/ui/misc";
import { DictateButton } from "../speech/DictateButton";
import { VoiceBar } from "../voice/VoiceBar";
import { VoiceButton } from "../voice/VoiceButton";
import { useVoice } from "../../stores/voice";
import { toast, toastError } from "../../components/ui/toast";
import { ModelMenu } from "./ModelMenu";

const iconBtn = "flex size-7 shrink-0 items-center justify-center rounded-btn text-fg hover:bg-fill";
const textBtn = "flex h-7 items-center gap-1.5 rounded-btn px-2.5 font-medium hover:bg-fill";

export function Composer({
  space,
  thread,
  ensureThread,
  sources,
}: {
  space: Space;
  thread?: Thread;
  ensureThread: () => Promise<Thread>;
  sources: { ready: number; inChat: number };
}) {
  const draftKey = thread?.id ?? `new:${space.id}`;
  const text = useDrafts((st) => st.drafts[draftKey] ?? "");
  const setDraftText = useDrafts((st) => st.setDraftText);
  const setText = (v: string | ((cur: string) => string)) => setDraftText(draftKey, v);
  const [busy, setBusy] = useState(false);
  const [photoOpen, setPhotoOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const navigate = useUi((st) => st.navigate);
  const setImportDialog = useUi((st) => st.setImportDialog);
  const sourcesOpen = useUi((st) => st.sourcesOpen[space.id] === true);
  const studioOpen = useUi((st) => st.studioOpen);
  const setSourcesOpen = useUi((st) => st.setSourcesOpen);
  const running = useChatStream((st) => (thread ? st.running[thread.id] : undefined));
  const pending = useChatStream((st) => (thread ? !!st.pending[thread.id] : false));
  const stop = useChatStream((st) => st.stop);
  const registerSend = useComposer((st) => st.register);
  const update = useUpdateSpace();
  const low = useLowEnergy(space.id);
  const voiceOn = useVoice((st) => st.phase !== "off" && st.spaceId === space.id);

  const send = async (override?: string) => {
    const msg = (override ?? text).trim();
    if (!msg || busy || running || pending) return;
    setBusy(true);
    let key = draftKey;
    let saved = false;
    try {
      const llm = await resolveChatModel(space);
      const t = thread ?? (await ensureThread());
      if (override === undefined) setDraftText(draftKey, "");
      key = t.id;
      if (ref.current) ref.current.style.height = "auto";
      await runTurn({
        onUserSaved: () => (saved = true),
        llm,
        space,
        threadId: t.id,
        tutorStyle: space.tutorStyle,
        controls: storedControls(llm),
        focus: useFocusStore.getState().state,
        userText: msg,
      });
    } catch (e) {
      if (!saved && override === undefined) setDraftText(key, (cur) => cur || msg);
      if (e instanceof TurnBusyError) {
        toast.info(e.message);
      } else if (e instanceof NoModelError) {
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

  const draft = useComposer((st) => (st.draft?.spaceId === space.id ? st.draft : null));
  const setDraft = useComposer((st) => st.setDraft);
  useEffect(() => {
    const d = useComposer.getState().draft;
    if (!draft || !d) return;
    setDraft(null);
    setText((cur) => (cur.trim() ? `${cur.trimEnd()}\n${d.text}` : d.text));
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
    });
  }, [draft, setDraft]);

  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    registerSend((t) => sendRef.current(t));
    return () => registerSend(null);
  }, [registerSend]);

  const disabled = busy || !!running || pending;
  const off = sources.ready - sources.inChat;

  return (
    <div className={cn("mx-auto rounded-pane border border-control bg-surface transition-colors focus-within:border-fg/40", studioOpen ? "max-w-[654px]" : "max-w-[652px]")}>
      {voiceOn && <VoiceBar />}
      <textarea
        ref={ref}
        rows={1}
        value={text}
        aria-label={s.chat.placeholder}
        placeholder={s.chat.placeholder}
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
        className={cn("block max-h-[220px] w-full resize-none bg-transparent px-3.5 pb-1.5 pt-3 text-input leading-[1.45] outline-none placeholder:text-faint focus-visible:outline-none", voiceOn && "hidden")}
      />
      <div className={cn("flex items-center gap-1 px-2 pb-2 pt-1.5", voiceOn && "hidden")}>
        <Menu>
          <Tooltip content={s.chat.attach} side="top">
            <MenuTrigger asChild>
              <button aria-label={s.chat.attach} className={iconBtn}>
                <Plus size={16} />
              </button>
            </MenuTrigger>
          </Tooltip>
          <MenuContent side="top" align="start" sideOffset={8} popover className="w-[220px]">
            <MenuItem disabled={low.active} title={low.reason} onSelect={() => setImportDialog({ open: true })}>
              <FileUp size={14} /> {s.chat.attachSource}
            </MenuItem>
            <MenuItem onSelect={() => setPhotoOpen(true)}>
              <Camera size={14} /> {s.chat.attachPhoto}
            </MenuItem>
          </MenuContent>
        </Menu>
        <Menu>
          <MenuTrigger asChild>
            <button aria-label={s.chat.tutorStyleTitle} className={cn(textBtn, "ps-2.5 pe-2 data-[state=open]:bg-fill")}>
              {s.space.tutorStyles[space.tutorStyle]}
              <ChevronDown size={13} />
            </button>
          </MenuTrigger>
          <MenuContent side="top" align="start" sideOffset={8} popover className="w-[248px]">
            <p className="pb-1 ps-3 pe-2.5 pt-2 text-label font-semibold text-muted">{s.chat.tutorStyleTitle}</p>
            <MenuRadioGroup
              value={space.tutorStyle}
              onValueChange={(v) =>
                update.mutate({ id: space.id, patch: { tutorStyle: v as TutorStyle } }, { onError: (e) => toastError(s.errors.generic, e) })
              }
            >
              {(["direct", "socratic", "mixed"] as const).map((v) => (
                <MenuRadioItem key={v} value={v} className="h-auto items-start py-2">
                  <span className="flex flex-col">
                    <span className="font-semibold">{s.space.tutorStyles[v]}</span>
                    <span className="mt-px text-label font-normal text-fg-secondary">{s.space.tutorStyleHelp[v]}</span>
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuContent>
        </Menu>
        <ModelMenu space={space} />
        {sources.ready > 0 && (
          <Tooltip content={s.chat.sourcesTip} side="top">
            <button aria-pressed={sourcesOpen} onClick={() => setSourcesOpen(space.id, !sourcesOpen)} className={cn(textBtn, "px-[9px] aria-pressed:bg-fill")}>
              <Library size={13} /> {off > 0 ? s.chat.sourcesOn(sources.inChat, sources.ready) : s.chat.sourcesCount(sources.inChat)}
            </button>
          </Tooltip>
        )}
        <div className="ms-auto flex items-center gap-1">
          <DictateButton
            className={iconBtn}
            onText={(t) => {
              setText((cur) => [cur.trim(), t].filter(Boolean).join(" "));
              ref.current?.focus();
            }}
          />
          <VoiceButton className={iconBtn} disabled={disabled} deps={{ space, thread, ensureThread }} />
          <button
            aria-label={running ? s.chat.stop : s.chat.send}
            disabled={!running && (disabled || !text.trim())}
            onClick={() => (running ? thread && stop(thread.id) : send())}
            className="flex size-[30px] items-center justify-center rounded-btn bg-primary text-on-primary transition-opacity hover:bg-primary-hover"
          >
            <span className="t-icon-swap" data-state={running ? "b" : "a"}>
              <ArrowUp size={15} data-icon="a" className="t-icon" />
              <Square size={12} fill="currentColor" data-icon="b" className="t-icon" />
            </span>
          </button>
        </div>
      </div>
      <PhotoDialog
        open={photoOpen}
        onOpenChange={setPhotoOpen}
        spaceId={space.id}
        onRead={(t) => {
          setText((cur) => [cur.trim(), t.problem, ...t.steps.map((x, i) => `${i + 1}. ${x}`)].filter(Boolean).join("\n"));
          setPhotoOpen(false);
          ref.current?.focus();
        }}
      />
    </div>
  );
}
