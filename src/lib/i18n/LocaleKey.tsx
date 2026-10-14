import { Fragment, type ReactNode } from "react";
import { useLocale } from "./state";

/** Remounts its children when the language changes so every string is read again. */
export function LocaleKey({ children }: { children: ReactNode }) {
  return <Fragment key={useLocale()}>{children}</Fragment>;
}
