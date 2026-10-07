/** Visual effects need the setting on and motion not reduced (app setting or OS). */
export const effectsActive = (visualEffects: boolean, reduced: boolean) => visualEffects && !reduced;
