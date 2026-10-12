import { useState } from "react";
import { Plus, X } from "lucide-react";
import { api } from "../../../lib/ipc";
import type { AppInfo } from "../../../lib/types";
import { useFocusPrefs, useSetFocusPref, type DistractionPrefs } from "../../../lib/focusPrefs";
import { s } from "../../../lib/strings";
import { Button } from "../../../components/ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "../../../components/ui/menu";
import { Segmented, Spinner, Switch } from "../../../components/ui/misc";
import { toastError } from "../../../components/ui/toast";
import { SettingsRow } from "../layout";

const GRACE = [5, 15, 30, 60] as const;

export function DistractionSettings() {
  const { prefs, isLoading, error } = useFocusPrefs();
  const setPref = useSetFocusPref();
  const [running, setRunning] = useState<AppInfo[] | null>(null);
  const [loading, setLoading] = useState(false);

  if (isLoading || error) return null;
  const d = prefs.distraction;

  const save = async (next: DistractionPrefs) => {
    try {
      await setPref("distraction", next);
    } catch (e) {
      toastError(s.distraction.saveFailed, e, () => void save(next));
    }
  };

  const loadApps = async () => {
    setLoading(true);
    try {
      setRunning(await api.runningApps());
    } catch (e) {
      setRunning([]);
      toastError(s.distraction.appsFailed, e);
    } finally {
      setLoading(false);
    }
  };

  const chosen = new Set(d.apps.map((a) => a.id));
  const options = (running ?? []).filter((a) => !chosen.has(a.id));

  return (
    <div data-testid="distraction-settings">
      <SettingsRow title={s.distraction.title} description={s.distraction.body}>
        <Switch label={s.distraction.title} checked={d.enabled} onCheckedChange={(enabled) => void save({ ...d, enabled })} />
      </SettingsRow>
      {d.enabled && (
        <div className="flex flex-col gap-2 pb-3">
          <ul data-testid="distraction-apps" className="flex flex-wrap gap-1.5">
            {d.apps.length === 0 && <li className="text-caption text-muted">{s.distraction.none}</li>}
            {d.apps.map((a) => (
              <li key={a.id} className="flex h-7 items-center gap-1 rounded-btn bg-fill pl-2.5 pr-1 text-label font-medium">
                {a.name}
                <button
                  type="button"
                  aria-label={s.distraction.remove(a.name)}
                  onClick={() => void save({ ...d, apps: d.apps.filter((x) => x.id !== a.id) })}
                  className="flex size-5 items-center justify-center rounded-kbd text-muted hover:bg-fill-hover hover:text-fg"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Menu onOpenChange={(open) => open && void loadApps()}>
              <MenuTrigger asChild>
                <Button size="sm" variant="secondary" data-testid="distraction-add">
                  <Plus size={14} />
                  {s.distraction.add}
                </Button>
              </MenuTrigger>
              <MenuContent align="start" className="max-h-72 overflow-y-auto">
                <MenuLabel>{s.distraction.running}</MenuLabel>
                {loading && (
                  <div className="flex h-7.5 items-center px-2.5">
                    <Spinner size={14} />
                  </div>
                )}
                {!loading && options.length === 0 && <div className="px-2.5 py-1.5 text-caption text-muted">{s.distraction.noRunning}</div>}
                {!loading &&
                  options.map((a) => (
                    <MenuItem key={a.id} onSelect={() => void save({ ...d, apps: [...d.apps, a].sort((x, y) => x.name.localeCompare(y.name)) })}>
                      {a.name}
                    </MenuItem>
                  ))}
              </MenuContent>
            </Menu>
            <span className="flex items-center gap-2 text-caption text-muted">
              {s.distraction.grace}
              <Segmented
                size="sm"
                label={s.distraction.grace}
                value={String(d.graceSec)}
                onChange={(v) => void save({ ...d, graceSec: Number(v) })}
                options={GRACE.map((g) => ({ value: String(g), label: s.distraction.seconds(g) }))}
              />
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
