import { useState } from "react";
import { Brain, Pencil, Trash2, User } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/ipc";
import { qk, useMemory } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { MemoryItem } from "../../lib/types";
import { relativeTime } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ErrorState, Skeleton, Tooltip } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";

export function MemorySection() {
  const { data, isLoading, error, refetch } = useMemory();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: qk.memory });

  const add = async () => {
    try {
      await api.addMemory(text, "user");
      setText("");
      refresh();
      toast.success(s.memory.saved);
    } catch (e) {
      toastError(s.errors.generic, e, add);
    }
  };

  return (
    <div data-testid="memory-section">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add();
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={s.memory.placeholder} aria-label={s.memory.placeholder} maxLength={500} />
        <Button type="submit" variant="primary" disabled={!text.trim()}>
          {s.memory.add}
        </Button>
      </form>
      {isLoading && <Skeleton className="mt-4 h-20" />}
      {error && <ErrorState title={s.errors.generic} error={error} onRetry={() => refetch()} />}
      {data && data.length === 0 && <p className="mt-4 text-sm text-muted">{s.memory.empty}</p>}
      <ul className="mt-3 divide-y divide-border">
        {data?.map((m) => (
          <MemoryRow key={m.id} item={m} onChange={refresh} />
        ))}
      </ul>
    </div>
  );
}

function MemoryRow({ item, onChange }: { item: MemoryItem; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const save = async () => {
    try {
      await api.updateMemory(item.id, text);
      setEditing(false);
      onChange();
    } catch (e) {
      toastError(s.errors.generic, e, save);
    }
  };
  const remove = async () => {
    try {
      await api.deleteMemory(item.id);
      onChange();
      toast.success(s.memory.forgot);
    } catch (e) {
      toastError(s.errors.generic, e, remove);
    }
  };
  const Origin = item.origin === "tutor" ? Brain : User;
  return (
    <li className="group flex items-center gap-3 py-2.5">
      <Tooltip content={item.origin === "tutor" ? s.memory.fromTutor : s.memory.fromYou}>
        <Origin size={15} className="shrink-0 text-muted" />
      </Tooltip>
      {editing ? (
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-label={s.common.edit} />
          <Button type="submit" size="sm" variant="primary" disabled={!text.trim()}>
            {s.common.save}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {s.common.cancel}
          </Button>
        </form>
      ) : (
        <>
          <p className="min-w-0 flex-1 text-sm">{item.text}</p>
          <span className="shrink-0 text-xs text-faint">{relativeTime(item.updatedAt)}</span>
          <button aria-label={s.common.edit} onClick={() => setEditing(true)} className="rounded-full p-1.5 text-muted opacity-0 hover:bg-surface-2 hover:text-fg focus:opacity-100 group-hover:opacity-100">
            <Pencil size={14} />
          </button>
          <button aria-label={s.memory.forget} onClick={remove} className="rounded-full p-1.5 text-muted opacity-0 hover:bg-danger-soft hover:text-danger focus:opacity-100 group-hover:opacity-100">
            <Trash2 size={14} />
          </button>
        </>
      )}
    </li>
  );
}
