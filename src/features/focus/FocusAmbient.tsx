import { useEffect, useRef } from "react";
import { AmbientPlayer } from "../../lib/ambient";
import { useFocusPrefs } from "../../lib/focusPrefs";
import { events } from "../../lib/ipc";
import { s } from "../../lib/strings";
import { toast } from "../../components/ui/toast";
import { useFocusStore } from "./focusStore";

/** Plays the chosen ambient sound during running work phases, and shows distraction nudges in the app. */
export function FocusAmbient() {
  const { prefs } = useFocusPrefs();
  const working = useFocusStore((st) => !!st.state && st.state.phase === "work" && !st.state.paused);
  const player = useRef<AmbientPlayer | null>(null);
  const { sound, volume } = prefs.ambient;

  useEffect(() => {
    if (working && sound !== "off") {
      player.current ??= new AmbientPlayer();
      void player.current.play(sound, volume).catch(() => {});
    } else player.current?.stop();
  }, [working, sound, volume]);

  useEffect(() => () => player.current?.stop(0.2), []);

  useEffect(() => {
    const un = events.focusDistraction((n) => toast(s.distraction.nudge(n.app.name, n.remainingMs)));
    return () => void un.then((f) => f()).catch(() => {});
  }, []);

  return null;
}
