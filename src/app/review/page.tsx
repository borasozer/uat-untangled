import { ensureFreshDemo } from "@/lib/demo";
import { getPeople, getQueue, getRules, getTicketQuotes, getTickets } from "@/lib/queries";
import { MANAGER_ID } from "@/lib/decide";
import { ReviewDesk } from "./review-desk";

/**
 * Review, the UAT manager's screen (Manager → Review). The server loads the reports still to decide, each with its
 * latest AI suggestion, the tickets and rules they are judged against, the people, and each ticket's first report;
 * ReviewDesk draws the whole screen in the browser. `?ref=FB-021` opens that report first (the tester's screen and the
 * import summary link here that way). The page only reads, after the shared demo's idle check; a decision is saved by
 * decideAction, through decide() in src/lib/decide.ts.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Review" };
// "Analyse now", for a report the AI has not finished, calls Claude from this page: server actions take the page's limit.
export const maxDuration = 120;

/**
 * Every ticket goes to the browser, so each is cut down to what Review shows, with the assignee's name instead of their
 * id.
 */
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  await ensureFreshDemo();
  const [items, tickets, people, rules, quotes, { ref }] = await Promise.all([
    getQueue(),
    getTickets(),
    getPeople(),
    getRules(),
    getTicketQuotes(1),
    searchParams,
  ]);
  const manager = people.find((p) => p.id === MANAGER_ID);
  return (
    <ReviewDesk
      items={items}
      rules={rules}
      initialRef={ref}
      manager={manager ? { name: manager.name, team: manager.team } : null}
      tickets={tickets.map((t) => ({
        id: t.id,
        key: t.key,
        title: t.title,
        summary: t.summary,
        kind: t.kind,
        origin: t.origin,
        status: t.status,
        status_note: t.status_note,
        severity: t.severity,
        step_id: t.step_id,
        reports: t.reports,
        testers: t.testers,
        assignee: people.find((p) => p.id === t.assignee_id)?.name ?? null,
        quotes: quotes[t.id] ?? [],
      }))}
    />
  );
}
