export const MAX_GL_SLOTS = 2;

const held = new Set<symbol>();

/** App-wide cap on live WebGL contexts for animated marks. Idempotent per id. */
export function acquireGlSlot(id: symbol): boolean {
  if (held.has(id)) return true;
  if (held.size >= MAX_GL_SLOTS) return false;
  held.add(id);
  return true;
}

export function releaseGlSlot(id: symbol) {
  held.delete(id);
}

export const glSlotsInUse = () => held.size;
