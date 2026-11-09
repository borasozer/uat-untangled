"use client";

import { Tip } from "@/components/ui/tip";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { finishBatchAction, importCsvAction } from "@/app/actions";
import { Pill } from "@/components/badges";
import { AiTag } from "@/components/ui/ai-tag";
import { BoxHeader } from "@/components/ui/box-header";
import { BusyLabel } from "@/components/ui/busy-label";
import { button } from "@/components/ui/button";
import { Clock, Lines } from "@/components/ui/icons";
import { checkSheet, MAX_IMPORT_ROWS, parseCsv, type SheetCheck } from "@/lib/csv";
import type { ImportPreview } from "@/lib/importer";
import { BUCKET_LABEL, formatWhen, type Bucket } from "@/lib/labels";
import type { BatchSummary } from "@/lib/queries";

/**
 * The import screen, in the browser. An uploaded sheet is checked here first (checkSheet in src/lib/csv.ts), and nothing
 * is sent until the person presses Import. Then importCsvAction checks the AI budget for every row and saves the rows as
 * new reports under one batch. This screen sends them to /api/analyse four at a time, one request per row so each row's
 * square fills as it is done, and finishBatchAction marks the batch finished and says what the rows became. Nothing
 * becomes a ticket here: every row waits for a person in Review.
 *
 * Importer: the buttons, the current import, and the analysis four rows at a time.
 * Skipped: the rows left out, and why.
 * CheckBox: an uploaded sheet before it is imported.
 * RunBox: the import while the AI reads it, one square per row, with Try again for a row that failed.
 * SamplePreview: six rows of the sample sheet, before anything is imported.
 * Summary: what the AI suggests for the rows, in the queue's words, with links into Review for the rows still waiting.
 */

const SAMPLE = "uat-cycle3-week2.csv";
/**
 * The sample rows shown before importing, so the variety is visible: one problem told two ways, a one-line report, a
 * Pass that hides a bug, an issue known before testing and an idea in a Pass row.
 */
const SAMPLE_ROWS = ["IMP-01", "IMP-02", "IMP-05", "IMP-14", "IMP-20", "IMP-21"];
/** Rows analysed at once, each its own /api/analyse request; each row makes one Claude call per AI run. */
const CONCURRENCY = 4;
/** The largest file the import accepts (see importCsvAction). */
const MAX_BYTES = 500_000;
/** Readable names for the fields a spreadsheet's columns are matched to (see lib/csv.ts). */
const COLUMN_LABEL: Record<keyof SheetCheck["columns"], string> = {
  ref: "Report ID",
  tester: "Tester",
  step: "Test step",
  result: "Result",
  text: "Comment",
  date: "Date",
};

/** One row's square in RunBox: grey while queued, pale while running, filled when done, red when it failed. */
type RowState = "queued" | "running" | "done" | "failed";
/** An import being analysed (or the last rows of an earlier one): one square per row. */
type Run = {
  label: string;
  /** The columns found and the rows skipped; none when finishing an earlier import. */
  preview: ImportPreview | null;
  batchId: string;
  ids: string[];
  states: RowState[];
  failures: string[];
  finished: boolean;
  /** Rows being tried again now, and rows that failed at first and went through when tried again. */
  retrying: number;
  recovered: number;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** `last`: the latest import, shown until a new one runs. `people` and `steps` check an uploaded sheet first. */
export function Importer({ last, people, steps }: { last: BatchSummary | null; people: string[]; steps: string[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [check, setCheck] = useState<{ file: string; text: string; result: SheetCheck } | null>(null);
  const [sample, setSample] = useState<string[][] | null>(null);
  const [summary, setSummary] = useState<BatchSummary | null>(last);
  // Whether the summary on screen came from a run in this visit (otherwise it is the last import, from before).
  const [fresh, setFresh] = useState(false);
  // One import or analysis at a time, even on a double click (the state flag updates only after a render).
  const working = useRef(false);

  // Show some rows of the sample, so people can see what the AI will be given.
  useEffect(() => {
    fetch(`/samples/${SAMPLE}`)
      .then((r) => r.text())
      .then((text) => setSample(parseCsv(text)))
      .catch(() => setSample(null));
  }, []);

  /** Analyses the given rows of a run, four at a time, then marks the import finished and shows what the rows became. */
  async function analyse(base: Run, ids: string[], retry = false) {
    const states = [...base.states];
    const failures: string[] = [];
    const index = new Map(base.ids.map((id, i) => [id, i]));
    for (const id of ids) states[index.get(id)!] = "queued";
    // While rows are tried again, the reason they failed stays on screen until there is a new answer.
    const show = (finished = false) =>
      setRun({
        ...base,
        states: [...states],
        failures: retry && !finished ? base.failures : [...failures],
        finished,
        retrying: retry && !finished ? ids.length : 0,
        recovered: retry && finished ? ids.length - failures.length : base.recovered,
      });
    show();
    let next = 0;
    async function worker() {
      while (next < ids.length) {
        const i = index.get(ids[next++])!;
        states[i] = "running";
        show();
        try {
          const res = await fetch("/api/analyse", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ feedbackId: base.ids[i] }),
          });
          // 409: the row was analysed already (its answer was lost on the way, or another tab got there first).
          if (!res.ok && res.status !== 409) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error ?? "the analysis did not finish");
          }
          states[i] = "done";
        } catch (e) {
          states[i] = "failed";
          failures.push(e instanceof Error ? e.message : "the analysis did not finish");
        }
        show();
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    // A lost connection here leaves the rows as they are: Review shows them, and the summary comes on the next visit.
    const finished = await finishBatchAction(base.batchId).catch(() => null);
    setSummary(finished?.ok ? finished.data : null);
    setFresh(true);
    show(true);
  }

  /** Runs one import step at a time; a second click while one runs does nothing. */
  async function exclusive(step: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await step();
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  const start = (csvText: string | (() => Promise<string>), sourceName: string) =>
    exclusive(async () => {
      const text = typeof csvText === "string" ? csvText : await csvText();
      const imported = await importCsvAction(text, sourceName).catch(() => ({
        ok: false as const,
        error: "No answer from the server. Reload the page to see whether the import started.",
      }));
      if (!imported.ok) {
        // Refused, so nothing was created: what is on the screen stays (the last import, an earlier run).
        setError(imported.error);
        return;
      }
      const { feedbackIds, preview, batchId } = imported.data;
      setCheck(null);
      setSummary(null);
      const states: RowState[] = feedbackIds.map(() => "queued");
      const label = sourceName.replace(/\.csv$/i, "");
      await analyse({ label, preview, batchId, ids: feedbackIds, states, failures: [], finished: false, retrying: 0, recovered: 0 }, feedbackIds);
    });

  /** Rows whose analysis failed, or an earlier import's rows that were never analysed, one more time. */
  const again = (base: Run, ids: string[], retry: boolean) => exclusive(() => analyse(base, ids, retry));

  const loadSample = () => start(async () => (await fetch(`/samples/${SAMPLE}`)).text(), SAMPLE);

  // An uploaded sheet is read here first: what it would create, and what will not be understood, before anything is
  // created or sent to the AI.
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    if (fileRef.current) fileRef.current.value = "";
    setError(null);
    const result = checkSheet(text, people, steps);
    if (text.length > MAX_BYTES) result.problem = "The file is too large (max 500 KB).";
    setCheck({ file: file.name, text, result });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-box-line bg-white shadow-box p-4">
        <button onClick={loadSample} disabled={busy} className={button("primary")}>
          Import sample (32 rows)
        </button>
        <span className="text-sm text-slate-500 max-sm:hidden">or</span>
        <Tip text={`Only a comments column is required. Up to ${MAX_IMPORT_ROWS} rows.`}>
          <label
            className={`cursor-pointer ${button("secondary")} has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent`}
          >
            Upload a CSV
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} disabled={busy} className="sr-only" />
          </label>
        </Tip>
        <a href={`/samples/${SAMPLE}`} download className="text-sm text-accent hover:underline">
          Download the sample
        </a>
        <span className="text-meta text-slate-500 max-sm:basis-full sm:ml-auto">
          Columns are matched by name (ID, tester, step, result, comments, date); only comments is required, up to{" "}
          {MAX_IMPORT_ROWS} rows.
        </span>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {check && (
        <CheckBox check={check} busy={busy} onImport={() => start(check.text, check.file)} onChoose={() => fileRef.current?.click()} />
      )}

      {/* The run first and what it became under it, so the squares being watched do not move when it finishes. */}
      {run && (
        <RunBox
          run={run}
          busy={busy}
          hasSummary={!!summary}
          onRetry={() => again(run, run.ids.filter((_, i) => run.states[i] === "failed"), true)}
        />
      )}

      {/* It stays while a new import is asked for (a refused one changes nothing), faded while rows are being analysed. */}
      {summary && (
        <Summary
          summary={summary}
          fresh={fresh}
          busy={busy}
          onAnalyse={
            run || summary.pending.length === 0
              ? undefined
              : () =>
                  again(
                    {
                      label: summary.label,
                      preview: null,
                      batchId: summary.id,
                      ids: summary.pending,
                      states: summary.pending.map(() => "queued"),
                      failures: [],
                      finished: false,
                      retrying: 0,
                      recovered: 0,
                    },
                    summary.pending,
                    false,
                  )
          }
        />
      )}

      {!run && !check && sample && <SamplePreview rows={sample} />}
    </div>
  );
}

/**
 * The rows left out and why, by row number with the header as row 1 (blank rows are not counted); nothing when none
 * were.
 */
function Skipped({ rows }: { rows: { row: number; reason: string }[] }) {
  if (rows.length === 0) return null;
  return (
    <p className="mt-2 text-slate-600">
      Skipped {plural(rows.length, "row", "rows")}: {rows.map((s) => `row ${s.row} (${s.reason})`).join(", ")}
    </p>
  );
}

/** An uploaded sheet before it is imported: the columns found, what will not be understood, and the one button. */
function CheckBox({
  check,
  busy,
  onImport,
  onChoose,
}: {
  check: { file: string; result: SheetCheck };
  busy: boolean;
  onImport: () => void;
  onChoose: () => void;
}) {
  const r = check.result;
  const notes: Partial<Record<keyof SheetCheck["columns"], [string, string]>> = {
    ...(r.unknownTesters.length > 0 && {
      tester: [
        `${plural(r.unknownTesters.length, "name", "names")} not in this cycle`,
        `Not in this cycle: ${r.unknownTesters.join(", ")}. The rows are kept, with the name in the text, but no one can be asked a question or told the outcome.`,
      ],
    }),
    ...(r.unknownSteps.rows > 0 && {
      step: [
        `${r.unknownSteps.rows} not recognised`,
        `Not a step of this cycle's test script: ${r.unknownSteps.examples.join(", ")}${r.unknownSteps.rows > r.unknownSteps.examples.length ? ", …" : ""}. These rows count as general feedback.`,
      ],
    }),
    ...(r.badDates > 0 && {
      date: [
        `${r.badDates} not understood`,
        `${plural(r.badDates, "date", "dates")} could not be read: ${r.badDates === 1 ? "that row gets" : "those rows get"} the day of the import.`,
      ],
    }),
  };
  return (
    <section aria-labelledby="import-check" className="overflow-hidden rounded-lg border border-box-line bg-white shadow-box text-sm">
      <BoxHeader
        icon={<Lines />}
        titleId="import-check"
        title={
          <span className="block max-w-[24rem] truncate" title={check.file}>
            {check.file}
          </span>
        }
        detail={!r.problem && <span className="min-w-0 truncate text-meta text-slate-500">· {plural(r.rows, "row", "rows")} to import</span>}
      />
      <div className="p-4">
        {r.problem ? (
          <p className="text-red-800">{r.problem}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-600">Columns:</span>
              {(Object.keys(COLUMN_LABEL) as (keyof SheetCheck["columns"])[]).map((field) => {
                const header = r.columns[field];
                const note = header ? notes[field] : undefined;
                return (
                  <Pill key={field} tone={!header || note ? "attention" : "neutral"}>
                    {COLUMN_LABEL[field]}: {header ?? "not found"}
                    {note && ` · ${note[0]}`}
                  </Pill>
                );
              })}
            </div>
            {/* What each amber pill means, readable without pointing at it (on a phone, with a keyboard). */}
            {Object.values(notes).length > 0 && (
              <ul className="mt-2 grid gap-0.5 text-meta text-amber-900">
                {(Object.keys(COLUMN_LABEL) as (keyof SheetCheck["columns"])[])
                  .filter((field) => r.columns[field] && notes[field])
                  .map((field) => (
                    <li key={field}>{notes[field]![1]}</li>
                  ))}
              </ul>
            )}
            <Skipped rows={r.skipped} />
          </>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {!r.problem && (
            <button onClick={onImport} disabled={busy} className={button("primary")}>
              <BusyLabel busy={busy} busyText="Importing…">
                Import {plural(r.rows, "row", "rows")}
              </BusyLabel>
            </button>
          )}
          <button onClick={onChoose} disabled={busy} className={button("secondary")}>
            Choose another file
          </button>
          {!r.problem && <span className="text-meta text-slate-500">Nothing goes to the AI until you import.</span>}
        </div>
      </div>
    </section>
  );
}

/** The import while the AI reads it: one square per row, and what to do about a row that failed. */
function RunBox({ run, busy, hasSummary, onRetry }: { run: Run; busy: boolean; hasSummary: boolean; onRetry: () => void }) {
  const done = run.states.filter((r) => r === "done").length;
  const failed = run.states.filter((r) => r === "failed").length;
  const total = run.ids.length;
  return (
    <section aria-labelledby="import-run" className="overflow-hidden rounded-lg border border-box-line bg-white shadow-box text-sm">
      <BoxHeader
        icon={<Clock />}
        titleId="import-run"
        title={run.preview ? `${run.finished ? "Imported" : "Importing"} ${run.label}` : `${run.finished ? "Analysed" : "Analysing"} the rest of ${run.label}`}
        // On a phone the note has its own line in both states, so the band keeps its height when the run ends.
        end={<span className="text-meta text-slate-600 max-sm:w-full">{run.finished ? "Finished." : "Keep this tab open until it finishes."}</span>}
      />
      <div className="p-4">
        {run.preview && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-600">Columns:</span>
              {Object.entries(run.preview.columns).map(([field, header]) => (
                <Pill key={field} tone={header ? "neutral" : "attention"}>
                  {COLUMN_LABEL[field as keyof SheetCheck["columns"]] ?? field}: {header ?? "not found"}
                </Pill>
              ))}
            </div>
            <Skipped rows={run.preview.skipped} />
          </>
        )}
        <div className={run.preview ? "mt-3" : ""}>
          <p className="text-slate-700">
            Analysed {done} of {total} rows{failed ? `, ${failed} failed` : ""}
          </p>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={done + failed}
          >
            <div className="h-full bg-accent-fill transition-all" style={{ width: `${total ? ((done + failed) / total) * 100 : 0}%` }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-1" aria-hidden>
            {run.states.map((r, i) => (
              <span
                key={i}
                // A row being analysed is a pale square that fills when it is done; nothing blinks.
                className={`h-3 w-3 rounded-sm transition-colors duration-300 ${
                  r === "done" ? "bg-accent-fill" : r === "running" ? "bg-accent/25" : r === "failed" ? "bg-red-500" : "bg-slate-200"
                }`}
              />
            ))}
          </div>
        </div>
        {/* From the first failure the line keeps its place and its size: the same words while the rows are tried again
            (the button says so), then a sentence of the same length, with the button's room kept. */}
        {(failed > 0 || run.retrying > 0 || run.recovered > 0) && (
          <p className={`mt-3 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 ${failed > 0 || run.retrying > 0 ? "text-red-700" : "text-slate-700"}`}>
            <span>
              {failed > 0 || run.retrying > 0
                ? `${plural(failed || run.retrying, "row", "rows")} could not be analysed: ${(run.failures[0] ?? "the analysis did not finish").replace(/\.$/, "")}.`
                : `${plural(run.recovered, "row", "rows")} failed at first and went through when tried again.`}
            </span>
            <button
              onClick={onRetry}
              disabled={busy}
              aria-hidden={failed === 0 && run.retrying === 0 ? true : undefined}
              tabIndex={failed === 0 && run.retrying === 0 ? -1 : undefined}
              className={`${button("secondary", "sm")} ${failed === 0 && run.retrying === 0 ? "invisible" : ""}`}
            >
              <BusyLabel busy={run.retrying > 0} busyText="Trying again…">
                Try again
              </BusyLabel>
            </button>
          </p>
        )}
        {run.finished && !hasSummary && failed === 0 && (
          <div className="mt-3 flex items-center gap-3">
            <Link href="/review" className={button("primary", "sm")}>
              Open Review
            </Link>
            <span className="text-slate-600">Each row now waits for a decision.</span>
          </div>
        )}
      </div>
    </section>
  );
}

/** SAMPLE_ROWS from the sample sheet, or its first six rows if one is missing: a table, or a list on a phone. */
function SamplePreview({ rows }: { rows: string[][] }) {
  const [header, ...body] = rows;
  const picked = SAMPLE_ROWS.map((id) => body.find((r) => r[0] === id)).filter((r): r is string[] => !!r);
  const shown = picked.length === SAMPLE_ROWS.length ? picked : body.slice(0, SAMPLE_ROWS.length);
  const comments = header.indexOf("Comments");
  return (
    <section aria-labelledby="import-sample" className="overflow-hidden rounded-lg border border-box-line bg-white shadow-box">
      <BoxHeader
        icon={<Lines />}
        titleId="import-sample"
        title="The sample: UAT Cycle 3, week 2"
        end={
          <span className="text-meta text-slate-500">
            {shown.length} of {body.length} rows
          </span>
        }
      />
      <ul className="divide-y divide-slate-100 text-sm sm:hidden">
        {shown.map((row) => (
          <li key={row[0]} className="px-4 py-2">
            <p className="text-meta text-slate-500">{row.filter((_, j) => j !== comments).join(" · ")}</p>
            {comments >= 0 && <p className="mt-0.5 text-slate-800">{row[comments]}</p>}
          </li>
        ))}
      </ul>
      <div className="overflow-x-auto max-sm:hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {header.map((h) => (
                <th key={h} className="whitespace-nowrap px-4 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row[0]} className="border-t border-slate-100 align-top">
                {row.map((cell, j) => (
                  <td key={j} className={`px-4 py-2 ${j === comments ? "min-w-72 text-slate-800" : "whitespace-nowrap text-slate-600"}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * What the AI suggests for an import's rows, in the review queue's words: one line per kind of row, then the new
 * problems with the rows that describe each. Nothing is created until a person decides each row in Review.
 */
function Summary({
  summary: s,
  fresh,
  busy,
  onAnalyse,
}: {
  summary: BatchSummary;
  fresh: boolean;
  busy: boolean;
  /** Analyses the rows of an earlier import that were never analysed. */
  onAnalyse?: () => void;
}) {
  const inProblems = s.problems.reduce((n, p) => n + p.refs.length, 0);
  const phrase: Record<Bucket, (n: number) => string> = {
    same_bug: (n) => plural(n, "for an existing ticket", "for existing tickets"),
    other_symptom: (n) => plural(n, "other symptom of a ticket", "other symptoms of tickets"),
    already_known: (n) => `${n} already known`,
    thin_evidence: (n) => plural(n, "needs one question", "need one question"),
    idea: (n) => plural(n, "idea", "ideas"),
    by_design: (n) => plural(n, "works as designed", "work as designed"),
    question: (n) => plural(n, "question", "questions"),
    nothing_to_fix: (n) => `${n} with nothing to fix`,
    new_bug: (n) => plural(n, "new bug", "new bugs"),
  };
  const inReview = s.sameAsReport.filter((w) => w.inReview).reduce((n, w) => n + w.refs.length, 0);
  const elsewhere = s.sameAsReport.filter((w) => !w.inReview).reduce((n, w) => n + w.refs.length, 0);
  const parts = [
    s.problems.length ? `${plural(s.problems.length, "new problem", "new problems")} (${plural(inProblems, "row", "rows")})` : null,
    inReview ? plural(inReview, "matches a report already in Review", "match reports already in Review") : null,
    elsewhere ? plural(elsewhere, "matches another report", "match other reports") : null,
    ...s.buckets.map((b) => phrase[b.bucket](b.refs.length)),
  ].filter(Boolean);
  const decided = new Set(s.decided);
  // Review opens on the first row that waits for a decision and has a suggestion to show.
  const listed = new Set([...s.problems.flatMap((p) => p.refs), ...s.sameAsReport.flatMap((w) => w.refs), ...s.buckets.flatMap((b) => b.refs)]);
  const first = s.refs.find((ref) => listed.has(ref) && !decided.has(ref));
  // A decided row has left the queue: name it, but do not link to a queue it is no longer in.
  const reviewLink = (ref: string) =>
    decided.has(ref) ? (
      <span key={ref} title="Decided" className="font-mono text-slate-500">
        {ref}
      </span>
    ) : (
      <Link key={ref} href={`/review?ref=${encodeURIComponent(ref)}`} className="font-mono text-accent hover:underline">
        {ref}
      </Link>
    );
  const undecided = s.rows - s.decided.length;
  const notAnalysed = s.rows - s.analysed;
  const status =
    s.decided.length === 0
      ? "Nothing is created yet: each row waits for you in Review."
      : `${s.decided.length} of ${s.rows} decided since; ${undecided === 0 ? "none wait" : `${undecided} ${undecided === 1 ? "waits" : "wait"}`} in Review.`;
  return (
    <section
      aria-labelledby="import-summary"
      aria-busy={busy}
      className={`overflow-hidden rounded-lg border border-box-line bg-white shadow-box text-sm transition-opacity ${busy ? "opacity-60" : ""}`}
    >
      <BoxHeader
        icon={<AiTag />}
        titleId="import-summary"
        title={fresh ? "What the AI suggests" : "Last import"}
        detail={
          <span className="min-w-0 truncate text-meta text-slate-500">
            · {s.label}
            {fresh ? "" : ` · ${formatWhen(s.createdAt)}`}
          </span>
        }
        end={
          <Link href={first ? `/review?ref=${encodeURIComponent(first)}` : "/review"} className={button("primary", "sm")}>
            Open Review
          </Link>
        }
      />
      <div className="p-4">
        <p className="text-[15px] font-medium text-slate-900">
          {parts.length ? `${plural(s.rows, "row", "rows")} → ${parts.join(" · ")}.` : `${plural(s.rows, "row", "rows")}, none analysed yet.`}
        </p>
        <p className="mt-0.5 text-meta text-slate-600">
          {fresh ? status : `What the AI suggested when the rows came in. ${status}`}
          {notAnalysed > 0 && ` ${plural(notAnalysed, "row", "rows")} not analysed yet.`}
          {/* Someone may be importing it right now, in another tab or another visit: their run analyses the rest. */}
          {notAnalysed > 0 && s.beingImported && ` Being imported now (started ${formatWhen(s.createdAt).split(", ")[1]}).`}
          {notAnalysed > 0 && onAnalyse && !s.beingImported && (
            <button onClick={onAnalyse} disabled={busy} className="ml-1.5 text-accent hover:underline disabled:opacity-50">
              Analyse {notAnalysed === 1 ? "it" : "them"} now
            </button>
          )}
        </p>
        {s.problems.length > 0 && (
          <div className="mt-3">
            <h3 className="text-meta font-medium text-slate-700">New problems, with every row that describes each</h3>
            <ul className="mt-1 grid gap-1">
              {s.problems.map((p) => (
                <li key={p.lead} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="flex gap-1.5">
                    {p.refs.map((ref, i) => (
                      <span key={ref}>
                        {reviewLink(ref)}
                        {i < p.refs.length - 1 && <span className="text-slate-400">,</span>}
                      </span>
                    ))}
                  </span>
                  <span className="min-w-0 truncate text-slate-700">&ldquo;{p.text}&rdquo;</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(s.buckets.length > 0 || s.sameAsReport.length > 0) && (
          <dl className="mt-3 grid gap-x-3 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
            {s.sameAsReport.map((w) => (
              <div key={w.target} className="contents">
                <dt className="text-slate-500">
                  Same as <span className="font-mono">{w.target}</span>
                  {w.inReview && <span className="text-slate-400"> (in Review)</span>}
                </dt>
                <dd className="flex flex-wrap gap-x-2">{w.refs.map(reviewLink)}</dd>
              </div>
            ))}
            {s.buckets.map((b) => (
              <div key={b.bucket} className="contents">
                <dt className="text-slate-500">
                  {BUCKET_LABEL[b.bucket]}
                  {b.tickets.length > 0 && <span className="text-slate-400"> → {b.tickets.join(", ")}</span>}
                </dt>
                <dd className="flex flex-wrap gap-x-2">{b.refs.map(reviewLink)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}
