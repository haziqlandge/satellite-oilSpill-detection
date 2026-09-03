/**
 * A figure that has not been built yet.
 *
 * Every block on this page builds its own scenario, and a scenario takes about
 * half a second of real work. The blocks are gated on approaching the viewport
 * so that work is spread out rather than all landing on load, which means there
 * is genuinely a moment where a figure exists but its data does not.
 *
 * Reserving the height is the whole job. A block that collapses to nothing and
 * then springs open when its run arrives shoves the page under the reader's
 * cursor, and on a page of six such blocks that happens six times.
 */

export function Loading({
  label = "Building",
  height = 280,
}: {
  label?: string;
  height?: number;
}) {
  return (
    <div
      className="flex items-center justify-center border"
      style={{
        height,
        borderColor: "var(--line)",
        background: "var(--base-2)",
      }}
      role="status"
    >
      <p className="text-faint font-mono text-[10px] tracking-[0.28em] uppercase">
        {label}
        <span className="ml-1 inline-block animate-pulse">…</span>
      </p>
    </div>
  );
}
