/** Vectors whose expected text the build cannot reproduce. Reasons: docs/redesign/calculator/QUESTIONS.md. */
export const KNOWN_DIVERGENCES: Record<string, string> = {
  "pow-piCoef11Digits": "reference shows 3.878509417*10^{10}; 12345678901π is 3.878509414*10^{10}",
};
