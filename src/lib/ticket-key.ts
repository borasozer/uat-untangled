/**
 * Ticket keys, shared by the server (which gives them) and the Review screen (which shows the next one before it is
 * given). Nothing about the app under test is written here: the prefix comes from the cycle's own tickets.
 */

type Keyed = { key: string; kind: "bug" | "idea" };

/** A bug's key with any prefix, in any case ("MIA-101"): group 1 is the prefix with its dash, group 2 the number. */
const BUG_KEY = /^([A-Z][A-Z0-9]*-)(\d+)$/i;
const IDEA_KEY = /^IDEA-(\d+)$/;

/**
 * Report refs: FB- for a report sent from the tester form, IMP- for an imported row (a sheet's own FB-, IMP- or TR- id
 * is kept).
 */
const REPORT_PREFIXES = ["FB-", "IMP-", "TR-"];

/**
 * The next ticket key. Bugs follow the cycle's own numbering, taken from its existing bug tickets (MIA-101 → MIA-102);
 * the most used prefix wins, and a tie goes to the prefix that comes first alphabetically, so the answer never depends
 * on the order the database returns. Tickets raised in the cycle start at 101, after the known issues logged before
 * testing; a cycle without bug tickets starts at BUG-101. Ideas are IDEA-01, IDEA-02 and so on.
 */
export function nextTicketKey(existing: Keyed[], kind: "bug" | "idea"): string {
  if (kind === "idea") {
    const max = existing.reduce((m, t) => Math.max(m, Number(IDEA_KEY.exec(t.key)?.[1] ?? 0)), 0);
    return `IDEA-${String(max + 1).padStart(2, "0")}`;
  }
  const bugs = existing.filter((t) => t.kind === "bug").map((t) => BUG_KEY.exec(t.key)).filter((m) => !!m);
  const counts = new Map<string, number>();
  for (const m of bugs) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  const prefix = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "BUG-";
  const max = bugs.filter((m) => m[1] === prefix).reduce((n, m) => Math.max(n, Number(m[2])), 0);
  return `${prefix}${Math.max(max + 1, 101)}`;
}

/** Finds the ticket keys and report refs a message mentions, whatever prefix the cycle's tickets use. */
export function keyPattern(keys: string[]): RegExp {
  const prefixes = new Set(["IDEA-", ...REPORT_PREFIXES]);
  for (const k of keys) {
    const m = BUG_KEY.exec(k);
    if (m) prefixes.add(m[1].toUpperCase());
  }
  const alternatives = [...prefixes].map((p) => p.slice(0, -1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(?:${alternatives.join("|")})-\\d+\\b`, "g");
}
