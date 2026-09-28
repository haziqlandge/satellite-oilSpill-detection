/**
 * Style A: the look of the reference explainer (Bravos Research, 1:08 to 1:15),
 * motion and material only -- charcoal ground under a soft vignette, raised dark
 * cards, a red that means "problem, oil, suspect" and a blue that means
 * "solved, data, physics". The console's own tokens are not used: the overlay
 * sits over the console and must read as a different layer.
 */
export const PT = {
  ground: "#121418",
  vignette: "#1d2025",
  card: "#25272c",
  hairline: "#33363d",
  red: "#d8344a",
  redGlow: "#e0364c",
  blue: "#2f7cf6",
  text: "#ffffff",
  body: "#9ea3ad",
} as const;

export const FONT = {
  head: '"Archivo Variable", "Archivo", sans-serif',
  body: '"Manrope Variable", "Manrope", sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
} as const;
