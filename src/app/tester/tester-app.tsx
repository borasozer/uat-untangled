"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { answerFollowUpAction, checkEvidenceAction, retestAction, submitFeedbackAction } from "@/app/actions";
import { Pill } from "@/components/badges";
import { StepPicker } from "@/components/step-picker";
import { AiTag } from "@/components/ui/ai-tag";
import { BoxHeader } from "@/components/ui/box-header";
import { BusyLabel } from "@/components/ui/busy-label";
import { button } from "@/components/ui/button";
import { Check, ChevronDown, Cross, Lines, Speech } from "@/components/ui/icons";
import { InfoTip } from "@/components/ui/info-tip";
import { LinkArrow } from "@/components/ui/link-arrow";
import { Segmented } from "@/components/ui/segmented";
import { Tip } from "@/components/ui/tip";
import { firstName, firstSentence, formatDay, formatSpan, formatWhen, TICKET_STATUS_LABEL } from "@/lib/labels";
import {
  GROUP_TITLE,
  nextLine,
  reportGroup,
  reportLabel,
  retestDue,
  yourTurn,
  type MyFeedback,
  type ReportGroup,
} from "@/lib/tester-status";
import type { Cycle, Person, Script, Step } from "@/lib/types";

/**
 * The tester's screen (/tester, loaded by page.tsx): a new report on the left, "Your reports" on the right; below 1024 px
 * the two take turns. On Send report a quick AI check may suggest the test step, when none is chosen, and may ask one
 * question about a missing detail. The tester can always skip both, and a check that fails never stops the report: it is
 * sent as it is. Everything is saved on the server (actions.ts), which analyses a new report after it has replied.
 *
 * TesterApp: the form and its stages (edit, checking, confirm the step, one question, sending, sent), and the two columns.
 * TestingCard: the app under test, the cycle and its dates, and how many test scripts.
 * ReportsBox: the tester's reports in four groups, Your turn first; on a wide screen the list scrolls inside the box.
 * ReportCard: one report, where it stands and what happens next; a click opens the step, the manager's reply and the ticket.
 * Question: the UAT manager's question, answered here; the answer sends the report back to the AI.
 * Retest: a fixed ticket to try again: "It works now", or "Still broken" with one line on what happened.
 */

/** The step a report is sent with, and whether it worked. */
type Chosen = { stepId: string | null; result: "pass" | "fail" | null };

/** The form's stages as they can come: typing, the quick AI check, a step to confirm, one question, sending, sent. */
type Stage =
  | { kind: "edit" }
  | { kind: "checking" }
  /** No step was chosen and the quick check thinks it knows which one: the tester confirms or changes it. */
  | { kind: "confirm"; guess: string; question: string | null }
  /** The step row shows the step the report will be sent with, so the question sends what is on screen. */
  | { kind: "question"; question: string }
  | { kind: "sending" }
  | { kind: "sent"; ref: string };

/** The text box's hint before a step is chosen; with a step, the hint asks what happened at that step. */
const PLACEHOLDER = "What did you do, and what went wrong? For example: I clicked Save, nothing happened and my changes were lost.";

/** A smooth scroll, or a jump for a person who asks their system for less motion. */
const scrolling = (): ScrollBehavior => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

/**
 * One tester's screen (`me`): page.tsx gives each tester a fresh one. With no tester in the database it only says to
 * start the demo over.
 */
export function TesterApp({
  me,
  manager,
  names,
  scripts,
  mine,
  cycle,
}: {
  me: Person | undefined;
  manager: string | null;
  /** Person id to name, for who fixed a ticket. */
  names: Record<string, string>;
  scripts: (Script & { steps: Step[] })[];
  mine: MyFeedback[];
  cycle: Cycle | null;
}) {
  const router = useRouter();
  // The step list opens on the script the tester last reported on: testers work through one script at a time.
  const lastScript = mine.find((f) => f.step)?.step?.script_id;
  const startScript = scripts.some((s) => s.id === lastScript) ? lastScript! : (scripts[0]?.id ?? "");
  const allSteps = scripts.flatMap((s) => s.steps);
  // No step is chosen for the tester: a report sent without one is general feedback, never filed against step 1.
  const [stepId, setStepId] = useState<string | null>(null);
  const step = allSteps.find((s) => s.id === stepId) ?? null;
  const [result, setResult] = useState<"pass" | "fail" | null>(null);
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "edit" });
  // "Other step" opens the step list; the report goes as soon as a step (or none) is picked there.
  const [resume, setResume] = useState<{ question: string | null } | null>(null);
  const pickerButton = useRef<HTMLButtonElement>(null);
  // The AI's question about the step takes the place of the Send button: the focus moves to it instead of being lost.
  const confirmRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (stage.kind === "confirm") confirmRow.current?.focus({ preventScroll: true });
  }, [stage.kind]);
  const [error, setError] = useState<string | null>(null);
  // On a phone the form and the list take turns.
  const [tab, setTab] = useState<"report" | "reports">("report");
  const [, startTransition] = useTransition();

  const anyInFlight = mine.some((f) => f.status === "new");
  // Refresh while a report is being analysed, for three minutes at most: a failed analysis must not
  // keep every open tab polling the server. Once at the start too: the page may have been fetched a few seconds
  // before it was opened (the header fetches a page as the pointer reaches its link, fetch-on-intent.ts).
  useEffect(() => {
    if (!anyInFlight) return;
    router.refresh();
    let ticks = 0;
    const t = setInterval(() => {
      if (++ticks > 36) clearInterval(t);
      else router.refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [anyInFlight, router]);

  // An answered card moves to its new group once the page has the new state: follow it there, so its thank-you line
  // is seen. The answer can come back before or after the new state, so both ends check.
  const follow = useRef<string | null>(null);
  const latest = useRef(mine);
  const followIfMoved = useCallback(() => {
    const f = latest.current.find((m) => m.ref === follow.current);
    if (!f || yourTurn(f)) return;
    follow.current = null;
    requestAnimationFrame(() =>
      document.getElementById(`report-${f.ref}`)?.scrollIntoView({ behavior: scrolling(), block: "center" }),
    );
  }, []);
  useEffect(() => {
    latest.current = mine;
    followIfMoved();
  }, [mine, followIfMoved]);
  const onAnswered = useCallback(
    (ref: string) => {
      follow.current = ref;
      followIfMoved();
    },
    [followIfMoved],
  );

  if (!me) return <p className="app-container py-6">No testers found. Use Start the demo over at the bottom of the page.</p>;
  const name = firstName(me.name);
  // By role on the cards ("UAT manager: …"); the name is in the note, so a first look is not a puzzle of who is who.
  const managerName = manager ? <ByRole role="UAT manager" name={manager} /> : "The UAT manager";
  const busy = stage.kind === "checking" || stage.kind === "sending";
  const waiting = mine.filter(yourTurn);
  const asked = mine.filter((f) => f.status === "needs_info").length;
  const retests = mine.filter(retestDue).length;
  const waitingLine = [
    asked ? `The UAT manager asked you ${asked === 1 ? "1 question" : `${asked} questions`}` : null,
    retests ? `${retests} fix${retests === 1 ? "" : "es"} to retest` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  function pick(id: string | null) {
    setStepId(id);
    setResult(null);
    if (stage.kind === "confirm") {
      // Choosing from the list while the AI asks about its guess is the tester's answer: send with what they chose.
      afterStep({ stepId: id, result: null }, stage.question);
    } else if (resume) {
      const question = resume.question;
      setResume(null);
      afterStep({ stepId: id, result: null }, question);
    }
  }

  function check() {
    setError(null);
    if (text.trim().length < 2) {
      setError("Please describe what happened.");
      return;
    }
    const chosen: Chosen = { stepId: step?.id ?? null, result: step ? result : null };
    if (resume) {
      const question = resume.question;
      setResume(null);
      afterStep(chosen, question);
      return;
    }
    setStage({ kind: "checking" });
    startTransition(async () => {
      const r = await checkEvidenceAction({ testerId: me!.id, ...chosen, text });
      if (!r.ok) {
        // The check is a helper only; never block a report because it failed.
        send(chosen, null, null);
        return;
      }
      const question = r.data.quality === "insufficient" && r.data.question ? r.data.question : null;
      if (!chosen.stepId && r.data.step_guess) setStage({ kind: "confirm", guess: r.data.step_guess, question });
      else afterStep(chosen, question);
    });
  }

  /** The step is settled (and shown in the step row): ask the quick question if there is one, otherwise send. */
  function afterStep(chosen: Chosen, question: string | null) {
    if (question) setStage({ kind: "question", question });
    else send(chosen, null, null);
  }

  function send(chosen: Chosen, question: string | null, followUpAnswer: string | null) {
    setStage({ kind: "sending" });
    startTransition(async () => {
      const r = await submitFeedbackAction({
        testerId: me!.id,
        ...chosen,
        text,
        followUpQuestion: question,
        followUpAnswer,
      });
      if (!r.ok) {
        setError(r.error);
        setStage({ kind: "edit" });
        return;
      }
      setStage({ kind: "sent", ref: r.data.ref });
      setText("");
      setAnswer("");
      setStepId(null);
      setResult(null);
    });
  }

  const guess = stage.kind === "confirm" ? (allSteps.find((s) => s.id === stage.guess) ?? null) : null;

  return (
    <div className="app-container grid grid-cols-1 gap-x-6 gap-y-4 py-5 lg:grid-cols-[minmax(0,1fr)_440px] xl:grid-cols-[minmax(0,1fr)_520px]">
      <div className="flex gap-0.5 rounded-md border border-slate-300 bg-white p-0.5 lg:hidden">
        {(["report", "reports"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-sm text-slate-700 aria-pressed:bg-white aria-pressed:text-accent-fill aria-pressed:inset-ring-[1.5px] aria-pressed:inset-ring-accent"
          >
            {t === "report" ? "Report" : `Your reports (${mine.length})`}
            {t === "reports" && waiting.length > 0 && (
              <>
                <span aria-hidden className="h-2 w-2 rounded-full bg-amber-500" />
                <span className="sr-only">, something is waiting for you</span>
              </>
            )}
          </button>
        ))}
      </div>

      <section aria-labelledby="report-title" className={`flex min-w-0 flex-col gap-3 ${tab === "reports" ? "max-lg:hidden" : ""}`}>
        <h1 id="report-title" className="text-title font-semibold text-slate-900">
          New report
        </h1>

        {waiting.length > 0 && (
          <button
            type="button"
            onClick={() => setTab("reports")}
            className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-left text-sm text-amber-950 lg:hidden"
          >
            {waitingLine}
            <span className="font-medium text-accent">
              Go to it
              <LinkArrow />
            </span>
          </button>
        )}

        {cycle && <TestingCard cycle={cycle} scripts={scripts.length} />}

        {stage.kind === "sent" ? (
          <div role="status" className="fade-in rounded-lg border border-box-line bg-white p-5 shadow-box">
            <p className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white">
                <Check className="h-4 w-4" draw />
              </span>
              Sent: report <span className="font-mono">{stage.ref}</span>
            </p>
            {/* A tester sends a report, not a ticket: what it becomes is the manager's decision. */}
            <p className="mt-2 text-slate-700">Thanks {name}. The UAT manager decides what it becomes and replies under Your reports.</p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              <button onClick={() => setStage({ kind: "edit" })} className={button("primary")}>
                Write another report
              </button>
              <Link href={`/review?ref=${stage.ref}`} className="text-sm text-accent hover:underline">
                Demo: see it as the manager
                <LinkArrow />
              </Link>
            </div>
          </div>
        ) : (
          <section aria-labelledby="what-title" data-tour="report" className="overflow-hidden rounded-lg border border-box-line bg-white shadow-box">
            <BoxHeader icon={<Speech />} title="What happened?" titleId="what-title" />
            <div className="px-4 py-3">
              <textarea
                aria-labelledby="what-title"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  // The guess was made from the words as they were: changing them means checking again on Send.
                  if (stage.kind === "confirm") setStage({ kind: "edit" });
                }}
                rows={5}
                disabled={busy}
                placeholder={step ? `What happened when you did “${step.instruction.replace(/\.$/, "")}”?` : PLACEHOLDER}
                className="block w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 text-[15px] placeholder:text-slate-400 hover:border-slate-400 focus:border-accent disabled:bg-slate-50 max-sm:text-base"
              />

              <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 border-t border-slate-100 pt-3 sm:h-[3.0625rem] sm:flex-nowrap">
                <span className="shrink-0 text-sm font-medium text-slate-700">
                  Test step
                  {!step && <span className="ml-1.5 text-meta font-normal text-slate-500">optional</span>}
                </span>
                <StepPicker
                  scripts={scripts}
                  value={stepId}
                  onChange={pick}
                  startScript={startScript}
                  buttonRef={pickerButton}
                  disabled={busy}
                />
                {step && (
                  <Segmented
                    legend="Did it work?"
                    hideLegend
                    className="shrink-0"
                    name="result"
                    value={result}
                    onChange={setResult}
                    disabled={busy}
                    options={[
                      {
                        value: "pass",
                        label: (
                          <span className="flex items-center gap-1.5">
                            <Check className="h-4 w-4" /> <span className="lg:max-xl:sr-only">It worked</span>
                          </span>
                        ),
                        title: "It worked",
                      },
                      {
                        value: "fail",
                        label: (
                          <span className="flex items-center gap-1.5">
                            <Cross className="h-4 w-4" /> <span className="lg:max-xl:sr-only">It didn&apos;t work</span>
                          </span>
                        ),
                        title: "It didn't work",
                      },
                    ]}
                  />
                )}
              </div>
              <p className="mt-1.5 h-5 truncate text-meta text-slate-500" title={step ? step.expected : undefined}>
                {step ? `Should happen: ${step.expected}` : "If you skip it, we may suggest one when you send."}
              </p>

              {stage.kind === "question" ? (
                <div className="mt-3 rounded-md border border-accent/20 bg-accent-soft p-3 text-sm">
                  <p className="flex items-center gap-2 font-medium text-slate-900">
                    <AiTag /> Before you send: one quick question
                  </p>
                  <p className="text-meta text-slate-600">
                    An automatic check thinks the developer will need this. You can skip it.
                  </p>
                  <label className="mt-1 grid gap-1.5">
                    <span className="text-slate-800">{stage.question}</span>
                    <textarea
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      rows={2}
                      autoFocus
                      className="rounded-md border border-slate-300 bg-white px-3 py-2 focus:border-accent max-sm:text-base"
                    />
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => send({ stepId, result: step ? result : null }, stage.question, answer)}
                      disabled={!answer.trim()}
                      className={button("primary")}
                    >
                      Send with my answer
                    </button>
                    <button onClick={() => send({ stepId, result: step ? result : null }, null, null)} className={button("secondary")}>
                      Skip and send
                    </button>
                  </div>
                </div>
              ) : stage.kind === "confirm" && guess ? (
                // The same height as the Send row it takes the place of, so nothing moves.
                <div
                  ref={confirmRow}
                  tabIndex={-1}
                  role="group"
                  aria-label="Which test step"
                  className="mt-3 flex h-10 outline-none items-center gap-2.5 rounded-md border border-accent/20 bg-accent-soft pr-1 pl-2.5 text-sm text-slate-900 max-sm:h-auto max-sm:flex-wrap max-sm:p-2"
                >
                  <AiTag />
                  <span className="min-w-0 truncate max-sm:whitespace-normal" title={`Should happen: ${guess.expected}`}>
                    Was this test step{" "}
                    <span className="font-semibold">
                      {guess.id}: {guess.instruction.replace(/\.$/, "")}
                    </span>
                    ?
                  </span>
                  <span className="ml-auto flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setStepId(guess.id);
                        afterStep({ stepId: guess.id, result: null }, stage.question);
                      }}
                      className={button("primary", "sm")}
                    >
                      Yes, send
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setResume({ question: stage.question });
                        setStage({ kind: "edit" });
                        // A click with detail 1, not .click(): Headless UI would take .click() for a screen reader's and ring the
                        // first step even after a mouse click. The keyboard still gets its ring.
                        requestAnimationFrame(() =>
                          pickerButton.current?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })),
                        );
                      }}
                      className={button("secondary", "sm")}
                    >
                      Other step
                    </button>
                    <button
                      type="button"
                      onClick={() => afterStep({ stepId: null, result: null }, stage.question)}
                      className={button("quiet", "sm")}
                    >
                      Not on a step
                    </button>
                  </span>
                </div>
              ) : (
                <div className="mt-3 flex h-10 items-center gap-3">
                  {/* The button keeps its words and size while it works; the line beside it says what is happening. */}
                  <button onClick={check} disabled={busy} className={button("primary")}>
                    Send report
                  </button>
                  {/* Always there, so a screen reader reads what it starts saying (empty, it takes back its gap); two lines fit
                      the 40 px row (a phone). */}
                  <span role="status" className="line-clamp-2 min-w-0 text-meta text-slate-500 empty:-ml-3">
                    {stage.kind === "checking"
                      ? `Checking your report… Looking for missing details${step ? "" : " and the test step"}.`
                      : stage.kind === "sending"
                        ? "Sending…"
                        : resume
                          ? "Pick the step above, or send as it is."
                          : ""}
                  </span>
                  <p role="alert" className="truncate text-sm text-red-700 empty:hidden">
                    {error}
                  </p>
                </div>
              )}
            </div>
          </section>
        )}
      </section>

      <ReportsBox
        mine={mine}
        manager={managerName}
        names={names}
        onAnswered={onAnswered}
        className={tab === "report" ? "max-lg:hidden" : ""}
      />
    </div>
  );
}

/** What is being tested: the app and the cycle, from the database. */
function TestingCard({ cycle, scripts }: { cycle: Cycle; scripts: number }) {
  const when = `${cycle.name} · ${formatSpan(cycle.starts_on, cycle.ends_on)}`;
  const count = `${scripts} test script${scripts === 1 ? "" : "s"}`;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-box-line bg-white shadow-box px-4 py-2.5">
      <svg
        aria-hidden
        viewBox="3 3 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth={0.85}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-8 w-8 shrink-0 text-accent"
      >
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
        <path d="M3.5 8.5h17M9 14l2 2 4-4" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-900">
          <span className="text-slate-500">You&apos;re testing </span>
          <span className="font-semibold">{cycle.app_name}</span>
        </p>
        {/* The first sentence on the line; the whole description behind the (i), never in the browser's own tooltip. */}
        <div className="flex min-w-0 items-center gap-1.5 text-meta text-slate-600">
          <p className="truncate">{firstSentence(cycle.app_description)}</p>
          <InfoTip label={`About ${cycle.app_name}`} text={cycle.app_description} />
        </div>
        <p className="text-meta text-slate-500 sm:hidden">
          {when} · {count}
        </p>
      </div>
      <p className="shrink-0 text-right text-meta text-slate-500 max-sm:hidden">
        {when}
        <br />
        {count}
      </p>
    </div>
  );
}

const ORDER: ReportGroup[] = ["turn", "waiting", "ticket", "done"];

/**
 * The tester's reports in a box of their own. On a wide screen the box is as tall as the screen allows and never
 * changes size: the list scrolls inside it, a pill says how many cards are still below, and the end is marked.
 */
function ReportsBox({
  mine,
  manager,
  names,
  onAnswered,
  className,
}: {
  mine: MyFeedback[];
  manager: ReactNode;
  names: Record<string, string>;
  onAnswered: (ref: string) => void;
  className: string;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const list = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(true);
  const [below, setBelow] = useState(0);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const measure = () => {
      const bottom = el.getBoundingClientRect().bottom;
      setAtEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 4);
      setBelow([...el.querySelectorAll("article")].filter((a) => a.getBoundingClientRect().bottom > bottom + 2).length);
    };
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (inner.current) ro.observe(inner.current);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, []);

  const groups = ORDER.map((g) => ({ g, items: mine.filter((f) => reportGroup(f) === g) })).filter((x) => x.items.length);
  return (
    <aside
      id="your-reports"
      data-tour="replies"
      aria-labelledby="your-reports-title"
      className={`relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-box-line bg-white shadow-box lg:h-[calc(100vh-var(--chrome-h)-2.5rem)] ${className}`}
    >
      <BoxHeader
        icon={<Lines />}
        titleId="your-reports-title"
        title={
          <>
            Your reports <span className="font-normal text-slate-500">{mine.length}</span>
          </>
        }
      />
      <div ref={list} className="min-h-0 flex-1 bg-slate-50 lg:overflow-y-auto">
        <div ref={inner} className="flex flex-col gap-3 p-3 sm:px-4">
          {mine.length === 0 ? (
            <p className="rounded-lg border border-box-line bg-white p-4 text-sm text-slate-500">
              Nothing yet. Your reports and the replies to them will appear here.
            </p>
          ) : (
            <>
              {groups.map(({ g, items }) => (
                <section key={g} aria-label={GROUP_TITLE[g]}>
                  <h3 className={`mb-1.5 text-meta font-medium ${g === "turn" ? "text-amber-900" : "text-slate-600"}`}>
                    {GROUP_TITLE[g]} <span className="font-normal text-slate-500">{items.length}</span>
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {items.map((f) => (
                      <li key={f.id}>
                        <ReportCard
                          f={f}
                          manager={manager}
                          names={names}
                          open={!!open[f.ref]}
                          onToggle={() => setOpen((o) => ({ ...o, [f.ref]: !o[f.ref] }))}
                          onAnswered={onAnswered}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              <p className="pb-1 text-center text-xs text-slate-400">
                {mine.length === 1 ? "That's your only report." : `That's all ${mine.length} reports.`}
              </p>
            </>
          )}
        </div>
      </div>
      {!atEnd && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-12 items-end justify-center bg-linear-to-b from-slate-50/0 to-slate-50 to-70% pb-2">
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => list.current?.scrollBy({ top: list.current.clientHeight * 0.8, behavior: scrolling() })}
            className="pointer-events-auto rounded-full border border-slate-300 bg-white px-2.5 py-0.5 text-xs text-slate-700 shadow-sm hover:bg-slate-50"
          >
            ↓ {below > 0 ? `${below} more` : "more"}
          </button>
        </div>
      )}
    </aside>
  );
}

/**
 * One report, short: where it stands, the tester's words on one line, and what happens next. A question to answer or
 * a fix to retest is always shown; the rest (step, the manager's reply, the ticket) opens with a click.
 */
function ReportCard({
  f,
  manager,
  names,
  open,
  onToggle,
  onAnswered,
}: {
  f: MyFeedback;
  manager: ReactNode;
  names: Record<string, string>;
  open: boolean;
  onToggle: () => void;
  /** Called once an answer is saved, so the page can follow the card to its new group. */
  onAnswered: (ref: string) => void;
}) {
  const label = reportLabel(f);
  const next = nextLine(f);
  const turn = yourTurn(f);
  // For these the reply is the outcome itself, so it is never hidden.
  const replyIsOutcome = (f.status === "answered" || f.status === "acknowledged") && !!f.tester_message;
  const details = `report-${f.ref}-details`;
  return (
    <article
      id={`report-${f.ref}`}
      className={`rounded-lg border bg-white text-[13px] leading-[1.125rem] ${turn ? "border-amber-300" : "border-box-line"}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={open ? details : undefined}
        className="block w-full rounded-lg px-3.5 py-2.5 text-left hover:bg-slate-50/70"
      >
        <span className="flex items-center gap-2">
          <Pill tone={label.tone}>{label.text}</Pill>
          <span className="ml-auto shrink-0 text-xs text-slate-500">
            <span className="font-mono text-slate-700">{f.ref}</span> · {formatDay(f.submitted_at)}
          </span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
        <span className={`mt-1.5 text-slate-900 ${open ? "block" : "line-clamp-1"}`}>&ldquo;{f.text}&rdquo;</span>
        {next && <span className="mt-0.5 block truncate text-xs text-slate-500">{next}</span>}
      </button>

      {replyIsOutcome && (
        <p className="mx-3.5 mb-2.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-slate-800">
          <span className="text-slate-500">{manager}:</span> {f.tester_message}
        </p>
      )}
      {f.status === "needs_info" && f.follow_up_question && (
        <Question f={f} manager={manager} onAnswered={onAnswered} />
      )}
      {retestDue(f) && f.ticket && f.fix && (
        <Retest f={f} fixedBy={f.fix.fixedBy ? names[f.fix.fixedBy] : null} onAnswered={onAnswered} />
      )}

      {open && (
        <div id={details} className="space-y-1.5 border-t border-slate-100 px-3.5 py-2.5 text-xs text-slate-600">
          <p>
            {formatWhen(f.submitted_at)} ·{" "}
            {f.step ? (
              <>
                Step <span className="font-mono">{f.step.id}</span> {f.step.instruction}
              </>
            ) : (
              "General feedback"
            )}
            {f.reported_result && (f.reported_result === "pass" ? " · it worked" : " · it didn't work")}
          </p>
          {f.follow_up_answer && (
            <p>
              You answered: <span className="text-slate-800">{f.follow_up_answer}</span>
            </p>
          )}
          {f.tester_message && !replyIsOutcome && (
            <p className="rounded-md bg-slate-50 px-2.5 py-1.5 text-[13px] text-slate-800">
              <span className="text-slate-500">{manager}:</span> {f.tester_message}
            </p>
          )}
          {f.ticket && (
            <p>
              <Link href={`/tickets/${f.ticket.key}`} className="font-mono text-accent hover:underline">
                {f.ticket.key}
              </Link>{" "}
              <span className="text-slate-800">{f.ticket.title}</span> · {TICKET_STATUS_LABEL[f.ticket.status].toLowerCase()}
            </p>
          )}
          {f.ticket?.status_note && <p>{f.ticket.status_note}</p>}
          {f.reopened?.note && <p>Reopened: &ldquo;{f.reopened.note}&rdquo;</p>}
          {f.fix && (
            <p>
              Fixed by <ByRole role="the developer" name={f.fix.fixedBy ? (names[f.fix.fixedBy] ?? null) : null} />,{" "}
              {formatWhen(f.fix.fixedAt)}
              {f.fix.note && <>: &ldquo;{f.fix.note}&rdquo;</>}
            </p>
          )}
          {f.retest && (
            <p>
              You retested on {formatWhen(f.retest.at)}: {f.retest.works ? "works now. Thank you." : "still broken."}
            </p>
          )}
        </div>
      )}
    </article>
  );
}

/** The UAT manager asked one question: answer it here. */
function Question({ f, manager, onAnswered }: { f: MyFeedback; manager: ReactNode; onAnswered: (ref: string) => void }) {
  const [answer, setAnswer] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-3.5 mb-2.5 rounded-md bg-amber-50 p-2.5">
      {/* Above the label, not in it: the role can take focus for its note, and a click on the question still goes to
          the answer box. */}
      <span className="block text-xs text-amber-900">{manager} asks</span>
      <label className="grid gap-1.5">
        <span className="text-amber-950">{f.follow_up_question}</span>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={2}
          className="rounded-md border border-amber-200 bg-white px-2.5 py-1.5 focus:border-accent max-sm:text-base"
        />
      </label>
      <button
        disabled={!answer.trim() || pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const r = await answerFollowUpAction(f.id, answer);
            if (!r.ok) setError(r.error);
            else onAnswered(f.ref);
          })
        }
        className={`mt-2 ${button("primary", "sm")}`}
      >
        <BusyLabel busy={pending} busyText="Sending…">
          Send answer
        </BusyLabel>
      </button>
      {error && (
        <p role="alert" className="mt-1 text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/** A person by role ("UAT manager", "the developer"), their name in a note on hover or keyboard focus when known. */
function ByRole({ role, name }: { role: string; name: string | null }) {
  if (!name) return <>{role}</>;
  return (
    <Tip reach text={name}>
      <span className="cursor-help underline decoration-slate-400 decoration-dotted underline-offset-[3px]">{role}</span>
    </Tip>
  );
}

/** The ticket is fixed: ask this tester to run the step again and say whether it works now. */
function Retest({
  f,
  fixedBy,
  onAnswered,
}: {
  f: MyFeedback;
  fixedBy: string | null;
  onAnswered: (ref: string) => void;
}) {
  const [note, setNote] = useState("");
  // "Still broken" opens one line first: on its own it tells the developer nothing.
  const [broken, setBroken] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const fix = f.fix!;
  const step = f.step ? `step ${f.step.id}` : "what you tested";

  function send(works: boolean) {
    setError(null);
    startTransition(async () => {
      const r = await retestAction(f.id, works, note);
      if (!r.ok) setError(r.error);
      else onAnswered(f.ref);
    });
  }

  return (
    <div className="mx-3.5 mb-2.5 rounded-md bg-amber-50 p-2.5">
      <p className="text-slate-900">
        <span className="font-medium">{f.ticket!.key} is fixed.</span> Please run {step} again and tell us.
      </p>
      <p className="mt-0.5 text-xs text-slate-600">
        <ByRole role="The developer" name={fixedBy} />, {formatWhen(fix.fixedAt)}
        {fix.note && <>: &ldquo;{fix.note}&rdquo;</>}
      </p>
      <label className="mt-2 grid gap-1">
        <span className={`text-xs ${broken ? "font-medium text-slate-900" : "text-slate-600"}`}>
          {broken ? "What happened this time? The developer needs one line to act on it." : "Anything to add? (optional)"}
        </span>
        <textarea
          ref={noteRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={broken ? 2 : 1}
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 focus:border-accent max-sm:text-base"
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        {broken ? (
          <>
            <button disabled={pending || !note.trim()} onClick={() => send(false)} className={button("primary", "sm")}>
              <Cross className="h-4 w-4" /> Send: still broken
            </button>
            <button disabled={pending} onClick={() => setBroken(false)} className={button("quiet", "sm")}>
              Back
            </button>
          </>
        ) : (
          <>
            <button disabled={pending} onClick={() => send(true)} className={button("primary", "sm")}>
              <Check className="h-4 w-4" /> It works now
            </button>
            <button
              disabled={pending}
              onClick={() => {
                if (note.trim()) send(false);
                else {
                  setBroken(true);
                  noteRef.current?.focus();
                }
              }}
              className={button("secondary", "sm")}
            >
              <Cross className="h-4 w-4" /> Still broken
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-1 text-meta text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
