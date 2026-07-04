// RugCheck adapter (Path B) — token security: rug verdict, mint/freeze authority,
// LP locked %, top-holder concentration. Public API, no key needed.
// Field shape verified against the live API (mintAuthority/freezeAuthority/rugged are top-level).

const BASE = "https://api.rugcheck.xyz/v1";

export async function report(mint) {
  const res = await fetch(`${BASE}/tokens/${mint}/report`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`RugCheck ${res.status}`);
  const r = await res.json();

  const risks = (r.risks || []).map((x) => ({ name: x.name, level: x.level }));
  const lpLockedPct = r.markets?.[0]?.lp?.lpLockedPct ?? null;
  const mintAuth = r.mintAuthority ?? null;     // non-null = team can still mint more (dilution risk)
  const freezeAuth = r.freezeAuthority ?? null; // non-null = team can freeze your tokens (honeypot risk)
  const rugged = r.rugged === true;

  const badges = [];
  if (rugged) badges.push("RUGGED");
  if (mintAuth) badges.push("MINT");
  if (freezeAuth) badges.push("FREEZE");
  if (lpLockedPct != null && lpLockedPct < 50) badges.push("LP UNLOCKED");
  for (const rk of risks.slice(0, 2)) badges.push(rk.name);

  let verdict = "safe";
  if (risks.some((x) => x.level === "warn") || mintAuth || freezeAuth || (lpLockedPct != null && lpLockedPct < 50)) {
    verdict = "caution";
  }
  if (rugged || risks.some((x) => x.level === "danger")) verdict = "danger";

  return {
    mint,
    verdict,                                  // safe | caution | danger
    score: r.score_normalised ?? r.score ?? null,
    rugged,
    mintAuth,
    freezeAuth,
    lpLockedPct,
    topHolderPct: r.topHolders?.[0]?.pct ?? null,
    badges,
  };
}
