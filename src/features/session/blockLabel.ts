import { s } from "../../lib/strings";
import type { Block } from "../../lib/session/engine";

export function blockLabel(b: Block): string {
  switch (b.kind) {
    case "review":
      return s.session.kinds.review(b.count ?? 0);
    case "retest":
      return s.session.kinds.retest(b.topic?.title ?? "");
    case "check":
      return s.session.kinds.check(b.topic?.title ?? "");
    case "project":
      return s.session.kinds.project(b.label ?? "", b.topic?.title ?? "");
    case "new":
      return s.session.kinds.new(b.label ?? b.topic?.title ?? s.session.kinds.newFallback);
    case "practice":
      return s.session.kinds.practice;
    default:
      return s.session.kinds.reflect;
  }
}
