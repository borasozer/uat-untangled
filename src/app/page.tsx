import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { AiTag } from "@/components/ui/ai-tag";
import { LinkArrow } from "@/components/ui/link-arrow";
import { RoleIcon, type Role } from "@/components/ui/role-icons";
import { calibrationInfo } from "@/lib/ai/calibration";
import { ensureFreshDemo } from "@/lib/demo";
import { env } from "@/lib/env";
import type { Action } from "@/lib/ai/schema";
import { ACTION_GROUPS, ACTION_LABEL, BUCKET_LABEL, type Bucket } from "@/lib/labels";
import { getOverview } from "@/lib/queries";
import { TourInvite } from "@/components/tour/tour-invite";

/**
 * The Overview, the home page: the whole loop in five cards, from a tester's report to the AI's suggestion, the UAT
 * manager's decision, the reply to the tester and the developers' ticket. Each card has a figure, live from the shared
 * demo apart from the AI's runs per report, and links into the views. It only reads, once it has started the shared demo
 * over if it was left changed and idle (ensureFreshDemo).
 *
 * Home: the five steps, their figures and words, and the page.
 * LineList: a step's explanation, a line per clause.
 * FlowCard: one card; with a mouse on a wide screen, pointing at it swaps the figures for the explanation.
 * Arrows: the chevrons in the gap after a card.
 * GapArrow: a bucket's arrow, pointing at its suggested outcome on the next card.
 * LoopBack: the line above the cards, from a tester's answer back to the AI.
 */

export const dynamic = "force-dynamic";

/** `attention` marks something waiting on a person, such as an open question. */
type StepLink = { href: string; label: string; primary?: boolean; attention?: boolean };

type Step = {
  title: string;
  /** Whose step it is: its icon sits at the end of the title row. */
  role: Role;
  value: number;
  label: string;
  /**
   * What happens in this step, a line per clause so it reads at a glance: on hover on a wide screen, inline everywhere
   * else. Split only where the card keeps its height.
   */
  detail: Lines;
  links: StepLink[];
  /** The AI's step carries the same AI mark as the suggestion on the review screen. */
  ai?: boolean;
  extra?: ReactNode;
  /** Its rows point at the same rows of the next card (wide screens), so the gap needs no chevron of its own. */
  rowArrows?: boolean;
};

/** Outcomes the tester has been told: the report became or joined a ticket or an idea, or was explained or thanked. */
const TOLD = ["linked", "ticketed", "idea", "answered", "acknowledged"];

/**
 * The buckets a first-time visitor should recognise (duplicates, known issues, thin reports, ideas, and a new bug), each
 * with the outcome the AI suggests for it: the inverse of `bucketOf`. In the Review queue's order. `outcome` words the
 * outcome where the action's own label would hide the difference: a known issue is a ticket too, but one the team had
 * before testing.
 */
const SHOWN: { bucket: Bucket; action: Action; outcome?: string }[] = [
  { bucket: "new_bug", action: "create_ticket" },
  { bucket: "same_bug", action: "link_to_ticket" },
  { bucket: "already_known", action: "link_to_ticket", outcome: "Add to the known issue" },
  { bucket: "thin_evidence", action: "ask_tester" },
  { bucket: "idea", action: "add_to_ideas" },
];
/** The buckets the cards leave out, named in one line of the AI card's explanation. */
const OTHER_BUCKETS = (Object.keys(BUCKET_LABEL) as Bucket[]).filter((b) => !SHOWN.some((s) => s.bucket === b));

/**
 * The bucket list and the outcome list beside it (wide screens): rows of one height with a hairline between them, so the
 * two cards read as the halves of one table.
 */
const ROWS = "divide-y divide-slate-100 text-meta";
/** One row of either list: the same height on both cards, so each bucket's arrow points at its outcome. */
const ROW = "flex h-[26px] items-center";

/**
 * `steps` are the first three cards, side by side on a wide screen; `outcomes` the last two, stacked in the fourth
 * column. The "right on samples" link is not live: it comes from data/calibration.json, fixed when the app is built.
 */
export default async function Home() {
  await ensureFreshDemo();
  const o = await getOverview();
  const count = (statuses: string[]) => o.feedback.filter((f) => statuses.includes(f.status)).length;
  const questions = count(["needs_info"]);
  // The open question leads to the tester who has to answer it.
  const asked = o.feedback.find((f) => f.status === "needs_info" && f.tester_id);
  const openBugs = o.tickets.filter((t) => t.kind === "bug" && ["open", "in_progress"].includes(t.status)).length;
  const fixed = o.tickets.filter((t) => t.kind === "bug" && t.status === "fixed").length;
  const samples = env.aiSamples;
  const { bins } = calibrationInfo();
  const measured = bins.reduce((sum, b) => ({ n: sum.n + b.n, correct: sum.correct + b.correct }), { n: 0, correct: 0 });

  const steps: Step[] = [
    {
      title: "Tester reports",
      role: "tester",
      value: o.feedback.length,
      label: "reports this cycle",
      detail: ["In their own words, on a test step or not.", "Missing a key detail? One short question first."],
      links: [
        { href: "/tester", label: "Report as a tester" },
        { href: "/import", label: "Import a spreadsheet" },
      ],
    },
    {
      title: "AI suggests",
      role: "ai",
      value: samples,
      label: "AI runs per report",
      detail: [
        `Reads each report ${samples} times against the steps, rules and tickets,`,
        "and says how sure it is and why.",
        "It changes nothing by itself.",
        `The other ${OTHER_BUCKETS.length} buckets: ${OTHER_BUCKETS.map((b) => BUCKET_LABEL[b]).join(", ")}.`,
      ],
      links: [{ href: "/insights", label: `${measured.correct} of ${measured.n} right on samples` }],
      ai: true,
      rowArrows: true,
      extra: (
        <>
          {/* Wide screens: one row per bucket, its arrow in the gap pointing at the outcome on the same row of the next card. */}
          <ul aria-label="Buckets" className={`mt-2 hidden ${ROWS} lg:block`}>
            {SHOWN.map(({ bucket }) => (
              <li key={bucket} className={`relative ${ROW} font-medium text-slate-800`}>
                {BUCKET_LABEL[bucket]}
                <GapArrow />
              </li>
            ))}
          </ul>
          {/* Elsewhere the cards stack: one line, never breaking inside a name. */}
          <p className="mt-3 text-meta font-medium text-slate-800 lg:hidden">
            {SHOWN.map(({ bucket }, i) => (
              <Fragment key={bucket}>
                {i > 0 && " · "}
                <span className="whitespace-nowrap">{BUCKET_LABEL[bucket]}</span>
              </Fragment>
            ))}
          </p>
        </>
      ),
    },
    {
      title: "Manager decides",
      role: "manager",
      value: count(["new", "awaiting_review"]),
      label: "waiting for review",
      detail: [
        "One report at a time:",
        "approve the suggested outcome in one click,",
        "or choose another, such as Explain & close or Thank & close.",
        "Every change is recorded.",
      ],
      links: [{ href: "/review", label: "Review", primary: true }],
      extra: (
        <>
          {/* Wide screens: the outcome the AI suggests for each bucket, on the row its arrow points at. */}
          <div className="mt-2 hidden text-meta lg:block">
            <ul aria-label="Suggested outcomes" className={`${ROWS} text-slate-800`}>
              {SHOWN.map(({ bucket, action, outcome }) => (
                <li key={bucket} className={ROW}>
                  <span className="sr-only">{BUCKET_LABEL[bucket]}: </span>
                  {outcome ?? ACTION_LABEL[action]}
                </li>
              ))}
            </ul>
            <p className="flex h-6 items-center text-slate-500">or another outcome</p>
          </div>
          {/* Elsewhere the cards stack, so the outcomes are listed by kind. */}
          <dl aria-label="Possible outcomes" className="mt-3 grid gap-1 text-meta text-slate-600 lg:hidden">
            {ACTION_GROUPS.map((g) => (
              <div key={g.id}>
                <dt className="font-medium text-slate-800">{g.label("the tester")}</dt>
                <dd>{g.actions.map((a) => ACTION_LABEL[a]).join(" · ")}</dd>
              </div>
            ))}
          </dl>
        </>
      ),
    },
  ];

  // A decision goes two ways at once: back to the tester, and to the developers as a ticket.
  const outcomes: Step[] = [
    {
      title: "Tester hears back",
      role: "tester",
      value: count(TOLD),
      label: "told the outcome",
      detail: "Every tester hears the outcome, ticket or not.",
      links: [
        { href: "/tester", label: "The tester's view" },
        ...(questions > 0
          ? [
              {
                href: asked ? `/tester?as=${asked.tester_id}` : "/tester",
                label: `${questions} open ${questions === 1 ? "question" : "questions"}`,
                attention: true,
              },
            ]
          : []),
      ],
    },
    {
      title: "Developers get a ticket",
      role: "developer",
      value: openBugs,
      label: "open bugs",
      // One sentence: as two lines it would make the right-hand column, and with it the row, taller on a 1280 px screen.
      detail: "One ticket per problem, with every report that describes it. Once fixed, those testers are asked to retest.",
      links: [{ href: "/tickets", label: "The developer's view" }],
      extra: fixed > 0 && <p className="mt-1 text-meta text-slate-700">{fixed} marked fixed, the testers asked to retest</p>,
    },
  ];

  return (
    // Room to breathe on a wide screen: a title and the five steps, in the middle of the screen.
    <div className="app-container pt-5 pb-3 lg:my-auto lg:py-8">
      {/* The tour's invitation sits beside the title, in the room the title leaves (wide screens only). */}
      <div className="relative">
        <h1 className="text-[1.75rem] leading-9 font-semibold tracking-tight text-slate-900 sm:text-[1.9375rem] sm:leading-[2.4375rem]">
          Test it. Say it. Sorted.
        </h1>
        <p className="mt-1 text-slate-600 sm:text-base lg:mt-2">Testers report. Claude suggests. A person decides.</p>
        <TourInvite />
      </div>

      <h2 className="sr-only">How it works</h2>
      <LoopBack />
      <ol data-tour="loop" className="mt-8 grid gap-3 sm:grid-cols-2 lg:mt-0 lg:grid-cols-4 lg:gap-6">
        {steps.map((s, i) => (
          <li key={s.title} className="relative flex">
            <FlowCard n={i + 1} step={s} />
            {!s.rowArrows && <Arrows count={i === steps.length - 1 ? outcomes.length : 1} />}
          </li>
        ))}
        <li className="flex flex-col gap-3">
          {outcomes.map((s, i) => (
            <FlowCard key={s.title} n={steps.length + i + 1} step={s} compact />
          ))}
        </li>
      </ol>
      <p className="mt-3 flex items-center gap-2 text-sm text-slate-500 lg:hidden">
        <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-slate-400">
          <path
            d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.5h-2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Asked for more detail? The tester&apos;s answer comes back to the AI (step 2).
      </p>
      <p className="mt-3 hidden text-meta text-slate-500 pointer-wide:block">Point at a step to see what happens in it.</p>

    </div>
  );
}

/** A sentence, or a few short lines to set one under another. */
type Lines = string | string[];

/**
 * One under another where it opens on hover (a wide screen with a mouse); elsewhere one paragraph, so a long line that
 * wraps on a phone does not leave a sentence broken in two.
 */
function LineList({ lines }: { lines: Lines }) {
  return typeof lines === "string"
    ? lines
    : lines.map((line, i) => (
        <span key={line} className="pointer-wide:block">
          {i > 0 && " "}
          {line}
        </span>
      ));
}

/** One step of the flow. Compact cards share the last column, one above the other. */
function FlowCard({ n, step, compact = false }: { n: number; step: Step; compact?: boolean }) {
  // On a wide screen with a mouse, pointing at the card swaps the figures for the sentence that explains the step.
  // The two share one grid cell, so the card keeps its height. Elsewhere both show, one below the other.
  const figures = "transition-opacity pointer-wide:group-hover:opacity-0 pointer-wide:group-focus-within:opacity-0";
  return (
    // `data-flow-card`: its icon plays a short gesture as the pointer arrives or the keyboard enters (globals.css).
    <div data-flow-card className="group flex flex-1 flex-col rounded-lg border border-box-line bg-white shadow-box p-4 transition-colors pointer-wide:hover:border-slate-400">
      <h3 className="flex items-center gap-2 font-semibold text-slate-900">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs text-white">{n}</span>
        {step.title}
        {step.ai && <AiTag />}
        {/* Not between lg and xl: the cards are narrow there and a long title would wrap. */}
        <RoleIcon
          role={step.role}
          className="ml-auto h-6 w-6 shrink-0 text-slate-400 transition-colors pointer-wide:group-hover:text-slate-500 lg:max-xl:hidden"
        />
      </h3>
      <div className={`flex-1 pointer-wide:grid pointer-wide:grid-rows-[auto_1fr] ${compact ? "mt-2" : "mt-3"}`}>
        <div className={`pointer-wide:[grid-area:1/1] ${figures}`}>
          <p>
            <span className={`font-semibold tabular-nums text-slate-900 ${compact ? "text-2xl" : "text-3xl"}`}>{step.value}</span>{" "}
            <span className="text-sm text-slate-600">{step.label}</span>
          </p>
        </div>
        <p className="mt-2 space-y-1 text-sm text-slate-700 transition-opacity pointer-wide:mt-0 pointer-wide:[grid-area:1/1/3/2] pointer-wide:opacity-0 pointer-wide:group-hover:opacity-100 pointer-wide:group-focus-within:opacity-100">
          <LineList lines={step.detail} />
        </p>
        {step.extra && <div className={`pointer-wide:[grid-area:2/1] ${figures}`}>{step.extra}</div>}
      </div>
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-sm ${compact ? "pt-2" : "pt-4"}`}>
        {step.links.map((l) => (
          <Link
            key={l.href + l.label}
            href={l.href}
            className={
              l.primary
                ? "rounded-md bg-white px-3 py-1.5 font-medium text-accent-fill inset-ring-[1.5px] inset-ring-accent hover:bg-accent-soft"
                : l.attention
                  ? "inline-flex items-center gap-1.5 text-amber-800 hover:underline"
                  : "font-medium text-accent hover:underline"
            }
          >
            {l.attention && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
            {l.label}
            {!l.attention && <LinkArrow />}
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Chevrons in the gap after a card; two when the flow splits into the stacked cards of the last column. */
function Arrows({ count }: { count: number }) {
  const tops = count === 1 ? ["top-1/2"] : ["top-1/4", "top-3/4"];
  return tops.map((top) => (
    <svg
      key={top}
      aria-hidden
      viewBox="0 0 12 12"
      className={`absolute -right-[18px] hidden h-3 w-3 -translate-y-1/2 text-slate-400 lg:block ${top}`}
    >
      <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ));
}

/**
 * A bucket row's arrow, in the gap after the card and pointing at the same row of the next card: past this card's
 * padding (1rem) and border (1px), then centred in the gap (lg:gap-6) less half its own width.
 */
function GapArrow() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 6 8"
      className="absolute top-1/2 left-[calc(100%+1rem+1px+0.75rem-3px)] h-2 w-1.5 -translate-y-1/2 text-slate-400"
    >
      <path d="M1 1l4 3-4 3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The return path above the cards: a tester's answer to a question goes back to the AI.
 * Runs from the middle of the last column (the tester card) to the middle of step 2 (3rem: two gaps of lg:gap-6).
 */
function LoopBack() {
  return (
    <div className="mt-9 hidden lg:grid lg:grid-cols-4 lg:gap-x-6">
      <div className="relative col-span-3 col-start-2 mx-[calc((100%-3rem)/6)] h-7 rounded-t-xl border-x border-t border-slate-300">
        <span className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap bg-canvas px-2 text-meta text-slate-600">
          Asked for more detail? The tester&apos;s answer comes back to the AI.
        </span>
        <svg aria-hidden viewBox="0 0 12 8" className="absolute -bottom-[3px] -left-[6.5px] h-2 w-3 text-slate-400">
          <path d="M1 1l5 5.5L11 1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
