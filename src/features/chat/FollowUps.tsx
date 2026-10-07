import { CornerDownRight, Plus } from "lucide-react";

export function FollowUps({ items, onAsk }: { items: string[]; onAsk: (text: string) => void }) {
  return (
    <div className="mt-0.5 flex flex-col border-t border-divider" data-testid="follow-ups">
      {items.map((f) => (
        <button
          key={f}
          onClick={() => onAsk(f)}
          className="flex h-9 items-center gap-2.5 border-b border-divider text-left text-body-lg text-fg hover:bg-fill-faint"
        >
          <CornerDownRight size={14} className="shrink-0 text-faint" />
          <span className="flex-1">{f}</span>
          <Plus size={14} className="shrink-0 text-faint" />
        </button>
      ))}
    </div>
  );
}
