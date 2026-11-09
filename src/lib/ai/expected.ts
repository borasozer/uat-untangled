import sample from "../../../data/sample/medinfo-cycle3.json";
import type { Truth } from "../types";

/** Which seed ticket each ground-truth cluster belongs to. */
export const CLUSTER_TICKET: Record<string, string> = Object.fromEntries(
  sample.tickets.map((t) => [t.cluster, t.key]),
);

/**
 * The decisions a careful UAT manager would accept for a labelled item, given the tickets that
 * exist and the other undecided reports (ref -> cluster). Returned as decision keys
 * (see decisionKey in schema.ts).
 */
export function acceptableDecisions(
  truth: Truth,
  ticketByCluster: Record<string, string>,
  pendingClusters: Record<string, string | null>,
  selfRef: string,
): string[] {
  if (truth.evidence === "insufficient") return ["ask_tester"];
  switch (truth.category) {
    case "question":
    case "not_a_bug":
      return ["answer"];
    case "praise":
      return ["acknowledge"];
  }
  const cluster = truth.cluster;
  const ticket = cluster ? ticketByCluster[cluster] : undefined;
  if (ticket) return [`link_to_ticket:${ticket}`];

  // A new problem: creating it is right; so is linking to another pending report of the same problem.
  const create = truth.category === "idea" ? "add_to_ideas" : "create_ticket";
  const siblings = Object.entries(pendingClusters)
    .filter(([ref, c]) => ref !== selfRef && c && c === cluster)
    .map(([ref]) => `link_to_ticket:${ref}`);
  return [create, ...siblings];
}
