/** Visual effects need the setting on and motion not reduced (app setting or OS). */
export const effectsActive = (visualEffects: boolean, reduced: boolean) => visualEffects && !reduced;

export const hasWebGL2 = () => typeof WebGL2RenderingContext !== "undefined";

/** The animated mark needs effects on, motion not reduced and WebGL2; otherwise the static image stays. */
export const markShaderEnabled = (visualEffects: boolean, reduced: boolean, webgl2: boolean) =>
  effectsActive(visualEffects, reduced) && webgl2;
