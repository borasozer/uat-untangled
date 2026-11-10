import type { Role } from "../ui/role-icons";

/**
 * The guided tour's stops, in order, and what each one says; tour.tsx shows them and moves between pages. A stop finds
 * its box by `data-tour="…"` in the page: rename one there and the stop shows MISSING instead, which wrongly tells the
 * visitor that someone else in the shared demo has changed the page. The tester, report and ticket the stops open (T1,
 * FB-026, MIA-101) are in the sample data.
 */

export type Side = "bottom" | "top" | "right" | "left";
/** The header's four views, by the `data-view` names nav.tsx gives their buttons; the light goes there on the way. */
type View = "overview" | "tester" | "manager" | "developer";

/**
 * One stop of the tour: the page it is on, the box it points at (`data-tour="…"` in the page), and what it says. The
 * words name no counts and no report's state: everyone shares one live demo, so what a step points at may have changed.
 */
export type TourStep = {
  /** The page; the tour opens `path + search` and knows it has arrived when the pathname is `path`. */
  path: string;
  search?: string;
  /** The view the page belongs to: on the way to another page the light first goes to that view's button. */
  view: View;
  /** What the light goes to on the way here instead (a ticket's row, the button that opens a window). */
  via?: () => HTMLElement | null;
  /** Opens the "How it's built" window first (nav.tsx listens for the event). */
  opens?: "how-built";
  /** The `data-tour` value of the box it points at; none: the whole page is dimmed and the step's box sits in the middle. */
  target?: string;
  /** Where the step's box goes, in order of preference; where none fits, the corner that covers least. */
  sides: Side[];
  /** The step's box may go up over the header (the first step: the view switch comes next). */
  high?: true;
  /** Above or below the lit box, the step's box lines up with its right edge (it would hide what the words name). */
  align?: "end";
  icon: Role;
  title: string;
  body: string;
};

/** The element a step points at, or goes through: the one that shows, where a page has a wide and a narrow form. */
export function visible(selector: string): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>(selector)].find((e) => e.getClientRects().length > 0) ?? null;
}

export const STEPS: TourStep[] = [
  {
    path: "/",
    view: "overview",
    target: "loop",
    sides: ["top", "bottom"],
    high: true,
    align: "end",
    icon: "overview",
    title: "The whole loop on one page",
    body: "A tester reports, the AI suggests, a person decides; the tester hears back and developers get one ticket per problem. The figures are live for this test cycle.",
  },
  {
    path: "/",
    view: "overview",
    target: "views",
    sides: ["bottom"],
    icon: "overview",
    title: "Three people, one switch",
    body: "Besides this Overview, each view is one person's side of the same test, with no sign-in: Tester, Manager and Developer. The tour visits them in that order.",
  },
  {
    path: "/tester",
    search: "?as=T1",
    view: "tester",
    target: "report",
    sides: ["bottom", "right"],
    icon: "tester",
    title: "In the tester's own words",
    body: "Testers describe what went wrong; they don't write tickets. On Send report, a quick AI check may ask one question about a missing detail; the tester can always skip it.",
  },
  {
    path: "/tester",
    search: "?as=T1",
    view: "tester",
    target: "replies",
    sides: ["left"],
    icon: "tester",
    title: "Where the tester hears back",
    body: "Every report gets a reply here, even one that never becomes a ticket. When a tester has a question to answer or a fix to retest, it comes first, under Your turn.",
  },
  {
    path: "/review",
    search: "?ref=FB-026",
    view: "manager",
    target: "queue",
    sides: ["right"],
    icon: "manager",
    title: "The UAT manager's queue",
    body: "Under To review, the AI has read each report: what it is and how sure. A thin one can go back to its tester with a question, and waits under Waiting for tester.",
  },
  {
    path: "/review",
    search: "?ref=FB-026",
    view: "manager",
    target: "suggestion",
    sides: ["right", "top", "bottom", "left"],
    icon: "ai",
    title: "What the AI thinks, and why",
    body: "Why flagged gives the reasons. Three separate AI runs read each report: the dots show how many agree, the figure turns amber below 85%, and the (i) shows how often that range was right, or that it was too rare to judge.",
  },
  {
    path: "/review",
    search: "?ref=FB-026",
    view: "manager",
    target: "decision",
    sides: ["left", "bottom", "top"],
    icon: "manager",
    title: "Nothing happens until approved",
    body: "Before approving, you see, and can edit, what it will create and the message the tester will read. Every other outcome is one click away; overruling the AI is recorded.",
  },
  {
    path: "/insights",
    view: "manager",
    // The tab's words, not the whole tab: the tab is as tall as the header (easy to click), too tall to light.
    via: () => visible('header nav[aria-label="Manager pages"] a[href="/insights"] > span'),
    target: "how-sure",
    sides: ["left", "right", "top", "bottom"],
    icon: "ai",
    title: "Can the figure be trusted?",
    body: "Insights measures it: at each confidence level, how often the AI was right on sample reports and on reports it never saw, and how often the manager kept its suggestion.",
  },
  {
    path: "/tickets",
    view: "developer",
    target: "to-fix",
    sides: ["bottom", "top"],
    align: "end",
    icon: "developer",
    title: "The developer's list",
    body: "Each ticket shows the reports and testers behind it, its status and who is on it. Below: problems known before testing, which new reports join, and ideas for the product team.",
  },
  {
    path: "/tickets/MIA-101",
    view: "developer",
    via: () => visible('main a[href="/tickets/MIA-101"]')?.closest<HTMLElement>("li") ?? null,
    target: "ticket",
    sides: ["bottom", "right"],
    icon: "developer",
    title: "Where a ticket comes from",
    body: "A ticket made in testing starts from one tester's report, approved by the UAT manager. The AI drafts its title, summary and steps to reproduce for developers; the manager can edit them before approving.",
  },
  {
    path: "/tickets/MIA-101",
    view: "developer",
    target: "evidence",
    sides: ["right", "top", "left"],
    icon: "developer",
    title: "Every report on the same problem",
    body: "Each report the manager adds keeps the tester's own words, marked Same bug or Other symptom. When the ticket is fixed, every one of these testers is asked to retest.",
  },
  {
    path: "/tickets/MIA-101",
    view: "developer",
    target: "jira",
    sides: ["left", "top", "bottom"],
    icon: "developer",
    title: "Ready for Jira",
    body: "The same ticket in Jira's own fields, to copy into the team's tracker. The description carries the steps, every tester's words and, once it is fixed, the retest results.",
  },
  {
    path: "/tickets/MIA-101",
    view: "developer",
    via: () => visible('[data-tour="how-built"]'),
    opens: "how-built",
    target: "parts",
    sides: ["right", "bottom", "left"],
    icon: "overview",
    title: "How it's built",
    body: "Only the server talks to Claude and the database, so no key reaches the browser. Open this again from the header later: Follow one report and Why trust it go further.",
  },
  {
    path: "/tickets/MIA-101",
    view: "developer",
    sides: [],
    icon: "tester",
    title: "Now try it yourself",
    body: "Send a report as Priya, then follow its link to Review: the AI's suggestion arrives in about 10 seconds, and you decide it. “Start the demo over”, at the bottom, resets the shared demo.",
  },
];

/** What a step says when its box is not on the page: someone else in the shared demo has just changed it. */
export const MISSING = "This part isn't on screen right now: someone using the shared demo has just changed it.";
