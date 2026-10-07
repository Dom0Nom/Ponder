import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/ipc";
import { qk, useMemory } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { MemoryItem } from "../../lib/types";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ErrorState, Skeleton } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { SettingsGroup, SettingsRow } from "./layout";

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
    <SettingsGroup data-testid="memory-section">
      {isLoading && <Skeleton className="my-3 h-12" />}
      {error && <ErrorState size="sm" title={s.errors.generic} error={error} onRetry={() => refetch()} />}
      {data && data.length === 0 && <p className="py-3 text-body text-muted">{s.memory.empty}</p>}
      {data?.map((m) => (
        <MemoryRow key={m.id} item={m} onChange={refresh} />
      ))}
      <form
        className="flex gap-2 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add();
        }}
      >
        <Input
          className="flex-1"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={s.memory.placeholder}
          aria-label={s.memory.placeholder}
          maxLength={500}
        />
        <Button type="submit" variant="secondary" disabled={!text.trim()}>
          {s.memory.add}
        </Button>
      </form>
    </SettingsGroup>
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
  if (editing)
    return (
      <form
        className="flex items-center gap-2 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Input autoFocus className="flex-1" value={text} onChange={(e) => setText(e.target.value)} aria-label={s.common.edit} />
        <Button type="submit" size="sm" variant="primary" disabled={!text.trim()}>
          {s.common.save}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          {s.common.cancel}
        </Button>
      </form>
    );
  return (
    <SettingsRow
      className="group"
      title={item.text}
      description={item.origin === "tutor" ? s.memory.fromTutor : s.memory.fromYou}
    >
      <Button
        variant="ghost"
        size="sm"
        aria-label={s.common.edit}
        className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        onClick={() => setEditing(true)}
      >
        {s.common.edit}
      </Button>
      <Button variant="ghost" size="sm" onClick={remove}>
        {s.memory.forget}
      </Button>
    </SettingsRow>
  );
}
