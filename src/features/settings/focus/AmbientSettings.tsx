import { useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { AMBIENT_SOUNDS, AmbientPlayer, type AmbientPrefs } from "../../../lib/ambient";
import { useFocusPrefs, useSetFocusPref } from "../../../lib/focusPrefs";
import { s } from "../../../lib/strings";
import { Button } from "../../../components/ui/button";
import { Segmented } from "../../../components/ui/misc";
import { Slider } from "../../../components/ui/slider";
import { toastError } from "../../../components/ui/toast";
import { SettingsRow } from "../layout";

export function AmbientSettings() {
  const { prefs, isLoading, error } = useFocusPrefs();
  const setPref = useSetFocusPref();
  const player = useRef<AmbientPlayer | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [volume, setVolume] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pending = useRef<(() => void) | null>(null);
  const latest = useRef(prefs.ambient);
  latest.current = prefs.ambient;

  const flush = () => {
    clearTimeout(timer.current);
    const run = pending.current;
    pending.current = null;
    run?.();
  };

  useEffect(
    () => () => {
      flush();
      player.current?.close();
    },
    [],
  );

  if (isLoading || error) return null;
  const a = prefs.ambient;
  const vol = volume ?? a.volume;

  const save = async (next: AmbientPrefs) => {
    try {
      await setPref("ambient", next);
    } catch (e) {
      toastError(s.ambient.saveFailed, e, () => void save(next));
    }
  };

  const preview = () => {
    player.current ??= new AmbientPlayer();
    if (previewing || a.sound === "off") {
      player.current.stop(0.3);
      setPreviewing(false);
    } else {
      void player.current.play(a.sound, vol);
      setPreviewing(true);
    }
  };

  return (
    <div data-testid="ambient-settings">
      <SettingsRow title={s.ambient.title} description={s.ambient.body}>
        <Segmented
          size="sm"
          label={s.ambient.title}
          value={a.sound}
          onChange={(sound) => {
            if (previewing) {
              if (sound === "off") {
                player.current?.stop(0.3);
                setPreviewing(false);
              } else void player.current?.play(sound, vol);
            }
            flush();
            void save({ ...latest.current, volume: vol, sound });
          }}
          options={[{ value: "off" as const, label: s.ambient.off }, ...AMBIENT_SOUNDS.map((v) => ({ value: v, label: s.ambient.sounds[v] }))]}
        />
      </SettingsRow>
      {a.sound !== "off" && (
        <SettingsRow title={s.ambient.volume}>
          <Button size="sm" variant="ghost" onClick={preview} data-testid="ambient-preview" aria-pressed={previewing}>
            {previewing ? <Square size={12} /> : <Play size={12} />}
            {previewing ? s.ambient.stop : s.ambient.preview}
          </Button>
          <Slider
            label={s.ambient.volume}
            value={Math.round(vol * 100)}
            min={0}
            max={100}
            step={5}
            format={(v) => `${v}%`}
            onChange={(v) => {
              setVolume(v / 100);
              player.current?.setVolume(v / 100);
              clearTimeout(timer.current);
              pending.current = () => void save({ ...latest.current, volume: v / 100 });
              timer.current = setTimeout(flush, 400);
            }}
          />
        </SettingsRow>
      )}
    </div>
  );
}
