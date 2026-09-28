/**
 * The overlay's house rules for on-screen words, as a check.
 *
 * No em or en dash, no hyphen standing between spaces, no semicolon (the
 * user's rule for everything the judges read). Hyphens inside a name --
 * Sentinel-1, User-GPU -- are words, not punctuation, and pass.
 *
 * And never a verdict: the system names candidates and suspects, never a
 * guilty, responsible or confirmed party (CLAUDE.md section 4). The one
 * exemption is the official problem statement, quoted verbatim.
 */
const RULES: { name: string; test: RegExp }[] = [
  { name: "em dash", test: /—/ },
  { name: "en dash", test: /–/ },
  { name: "spaced hyphen", test: /(^|\s)-(\s|$)/ },
  { name: "semicolon", test: /;/ },
];
const VERDICT = /\b(guilty|responsible|confirmed)\b/i;

export function copyViolations(text: string, opts: { officialTitle?: boolean } = {}): string[] {
  const found = RULES.filter((r) => r.test.test(text)).map((r) => `${r.name} in "${text}"`);
  if (!opts.officialTitle && VERDICT.test(text)) found.push(`verdict word in "${text}"`);
  return found;
}
