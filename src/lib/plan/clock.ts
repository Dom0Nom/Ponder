import { localDate } from "./schedule";

/** Current time; follows the mock backend's clock when running outside Tauri. */
export function appNow(): number {
  const mock = (window as unknown as { __mock?: { db: () => { clockOffset: number } } }).__mock;
  return Date.now() + (mock?.db().clockOffset ?? 0);
}

export const todayDate = () => localDate(appNow());
