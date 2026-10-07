/** Vectors whose expected text contradicts the guidebook or other vectors. Reasons: docs/redesign/calculator/QUESTIONS.md. */
export const KNOWN_DIVERGENCES: Record<string, string> = {
  "trig-asinhByEdit": "QUESTIONS Q1, ↓ indicator",
  "const-kSquare": "QUESTIONS Q1, ↓ indicator",
  "const-kOff": "QUESTIONS Q1, ↓ indicator",
  "frac-mpToggleBack": "QUESTIONS Q2, tall rows",
  "trig-radFiveCosToggle": "QUESTIONS Q2, tall rows",
  "stat-oneToFiveResults": "QUESTIONS Q3, stat trailing zeros",
  "stat-oneToFiveScroll": "QUESTIONS Q3, stat trailing zeros",
  "stat-formulaResult": "QUESTIONS Q4, data editor rows",
  "edit-deleteFunctionToken": "QUESTIONS Q5, stray )",
  "var-varTimesVar": "QUESTIONS Q6, var cycling",
  "var-recallFraction": "QUESTIONS Q7, variables store decimals",
};
