// Tiny terminal table + number formatting helpers (zero deps).

export function money(n) {
  if (!n) return "$0";
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (a >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toPrecision(3)}`;
}

export function pct(n) {
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(1)}%`;
}

export function age(h) {
  if (h == null) return "?";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(0)}h`;
  return `${(h / 24).toFixed(0)}d`;
}

export function table(rows, cols) {
  const widths = cols.map((c) =>
    Math.max(c.header.length, ...rows.map((r) => String(c.get(r)).length))
  );
  const line = (cells) =>
    cells.map((cell, i) => String(cell).padEnd(widths[i])).join("  ");
  const out = [line(cols.map((c) => c.header))];
  out.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) out.push(line(cols.map((c) => c.get(r))));
  return out.join("\n");
}
