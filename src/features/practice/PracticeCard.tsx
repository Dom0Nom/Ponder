import { useQuery } from "@tanstack/react-query";
import { Dumbbell } from "lucide-react";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import type { Space } from "../../lib/types";
import { skillPercent } from "../../lib/practice/irt";
import { useUi } from "../../stores/ui";
import { Button } from "../../components/ui/button";

export function PracticeCard({ space }: { space: Space }) {
  const navigate = useUi((st) => st.navigate);
  const { data } = useQuery({ queryKey: ["abilities", space.id], queryFn: () => api.abilitiesList(space.id) });
  const recent = [...(data ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  return (
    <div className="rounded-[var(--radius-card)] border border-border p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-medium">
        <Dumbbell size={15} className="text-muted" /> {s.practice.title}
      </h3>
      <p className="text-xs text-muted">{s.practice.cardHint}</p>
      {recent.length > 0 && (
        <ul className="mt-2 space-y-1">
          {recent.map((a) => (
            <li key={a.topicKey}>
              <button
                onClick={() => navigate({ name: "practice", spaceId: space.id, topicKey: a.topicKey })}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left text-xs hover:bg-fill"
              >
                <span className="min-w-0 flex-1 truncate">{a.topicTitle}</span>
                <span className="tabular-nums text-faint">{skillPercent(a.theta)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button size="sm" className="mt-3" data-testid="practice-button" onClick={() => navigate({ name: "practice", spaceId: space.id })}>
        {s.practice.open}
      </Button>
    </div>
  );
}
