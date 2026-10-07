import { type State, initialState, press } from "./calc";
import { model, text } from "./render";

export { KEYS, type Key, type State } from "./calc";
export { model, text, type Model, type Row } from "./render";

/** Calculator engine facade: key presses in, display text out. */
export class Calculator {
  state: State;
  constructor(state?: State) {
    this.state = state ?? initialState();
  }
  press(key: string) {
    press(this.state, key);
  }
  pressAll(keys: string[]) {
    for (const k of keys) press(this.state, k);
  }
  text() {
    return text(this.state);
  }
  model() {
    return model(this.state);
  }
  reset() {
    this.state = initialState();
  }
  serialize(): string {
    return JSON.stringify(this.state);
  }
  static load(json: string | null): Calculator {
    if (!json) return new Calculator();
    try {
      const st = JSON.parse(json) as State;
      if (!st || !st.modes || !st.screen) return new Calculator();
      return new Calculator({ ...initialState(), ...st });
    } catch {
      return new Calculator();
    }
  }
}
