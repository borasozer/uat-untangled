"use client";

import { useState, useTransition } from "react";
import { markFixedAction, pickUpAction, reopenAction } from "@/app/actions";
import { BoxHeader } from "@/components/ui/box-header";
import { BusyLabel } from "@/components/ui/busy-label";
import { button } from "@/components/ui/button";
import { Check, Cross } from "@/components/ui/icons";
import { RoleIcon } from "@/components/ui/role-icons";
import { firstName, formatDay, retestTally } from "@/lib/labels";
import type { TicketStatus } from "@/lib/types";

/**
 * The Developer box on a ticket's page: page.tsx shows it for bugs found in this cycle and works out the state it shows.
 * Each button is one server action (pickUpAction, markFixedAction, reopenAction, then src/lib/ticket-work.ts), which
 * refuses if the ticket has changed in the meantime. Testers answer the retest on their own screen, not here.
 */

export type Retest = { name: string; ref: string; at: string; note: string | null };

/**
 * What the developer can do with a bug ticket, one step at a time: pick it up, mark it fixed (the testers who
 * reported it are asked to retest), or reopen it. Each state says what happens next, in few words.
 */
export function DevPanel({
  className = "",
  ticketKey,
  status,
  owner,
  developer,
  testers,
  confirmed,
  waiting,
  newSinceFix,
  fix,
  reopened,
}: {
  className?: string;
  ticketKey: string;
  status: TicketStatus;
  owner: string | null;
  developer: string;
  /** Testers who reported this ticket: they are asked to retest when it is fixed. */
  testers: string[];
  /** Every one of them says it works now. */
  confirmed: boolean;
  /** Those who have not answered since the fix, with their report. */
  waiting: { name: string; ref: string }[];
  /** Reports that arrived after the ticket was marked fixed. */
  newSinceFix: number;
  fix: { at: string; by: string | null; note: string | null; passed: Retest[]; failed: Retest[] } | null;
  /** Reopened after the fix: why, and who still found it broken. Shown while it is worked on again. */
  reopened: { at: string; note: string | null; failed: Retest[] } | null;
}) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, message: string) {
    setError(null);
    setDone(null);
    startTransition(async () => {
      const r = await action();
      if (!r.ok) setError(r.error);
      else {
        setNote("");
        setDone(message);
      }
    });
  }
  const reopen = () => run(() => reopenAction(ticketKey, note), "Reopened: back to In progress.");

  const first = developer.split(" ")[0];
  const noteField = (label: string, rows: number, placeholder?: string) => (
    <label className="grid gap-1">
      <span className="text-meta text-slate-600">{label}</span>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="rounded-md border border-slate-300 px-2.5 py-1.5 placeholder:text-slate-400 focus:border-accent max-sm:text-base"
      />
    </label>
  );

  return (
    <section aria-labelledby="dev-work" className={`overflow-hidden rounded-lg border border-box-line bg-white shadow-box text-sm ${className}`}>
      <BoxHeader icon={<RoleIcon role="developer" />} title="Developer" titleId="dev-work" />
      <div className="p-4">
        <p className="text-slate-700">
          Owner: {owner ? <span className="font-medium text-slate-900">{owner}</span> : <span className="text-slate-600">no one yet</span>}
        </p>

        {(status === "open" || status === "planned") && (
          <div className="mt-3 grid">
            <button disabled={pending} onClick={() => run(() => pickUpAction(ticketKey), `${first} has picked it up.`)} className={button("primary")}>
              {pending ? "Saving…" : `Pick up as ${first}`}
            </button>
          </div>
        )}

        {status === "in_progress" && (
          <div className="mt-3 grid gap-2">
            {reopened && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-950">
                Reopened {formatDay(reopened.at)}
                {reopened.note ? <>: &ldquo;{reopened.note}&rdquo;</> : "."}
                {reopened.failed.map((r) => (
                  <span key={r.ref} className="mt-1 block">
                    Still broken for {r.name} ({r.ref}){r.note ? <>: &ldquo;{r.note}&rdquo;</> : "."}
                  </span>
                ))}
              </p>
            )}
            {noteField("Note for the testers (optional)", 2, "Which build, and what changed")}
            <button
              disabled={pending}
              onClick={() =>
                run(
                  () => markFixedAction(ticketKey, note),
                  `Marked fixed. ${testers.length} tester${testers.length === 1 ? " is" : "s are"} asked to retest.`,
                )
              }
              className={button("primary")}
            >
              {pending
                ? "Saving…"
                : `Mark fixed, ask ${testers.length} tester${testers.length === 1 ? "" : "s"} to retest`}
            </button>
          </div>
        )}

        {status === "fixed" && fix && (
          <div className="mt-3 grid gap-2">
            <p className="rounded-md bg-slate-50 px-3 py-2 text-slate-900">
              Fixed {formatDay(fix.at)}
              {fix.note && <span className="block text-slate-800">&ldquo;{fix.note}&rdquo;</span>}
            </p>
            {confirmed ? (
              <>
                <p className="flex gap-1.5 font-medium text-slate-900">
                  <Check className="mt-0.5 h-4 w-4 shrink-0" />
                  {fix.passed.length === 1
                    ? `Confirmed by ${firstName(fix.passed[0].name)}, who reported it.`
                    : `Confirmed by all ${fix.passed.length} testers: ${listOf(fix.passed.map((r) => firstName(r.name)))}.`}
                </p>
                {/* Nothing closes by itself: the developer can still reopen it. */}
                <div>
                  <button disabled={pending} onClick={reopen} className={button("secondary", "sm")}>
                    <BusyLabel busy={pending} busyText="Saving…">
                      Reopen
                    </BusyLabel>
                  </button>
                </div>
              </>
            ) : (
              <>
                {newSinceFix > 0 && (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-950">
                    {newSinceFix} new report{newSinceFix === 1 ? "" : "s"} since the fix: it may not cover {newSinceFix === 1 ? "it" : "them"}.
                  </p>
                )}
                <div>
                  <p className="text-meta font-medium text-slate-600">
                    Retest: {retestTally(fix.passed.length, fix.failed.length, waiting.length)}
                  </p>
                  {/* "Still broken" first: that is what needs a look. */}
                  <ul className="mt-1 grid gap-1">
                    {fix.failed.map((r) => (
                      <li key={r.ref} className="flex gap-1.5 text-slate-800">
                        <Cross className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                        <span>
                          {r.name} ({r.ref}): still broken{r.note && <span className="text-slate-600">: {r.note}</span>}
                        </span>
                      </li>
                    ))}
                    {fix.passed.map((r) => (
                      <li key={r.ref} className="flex gap-1.5 text-slate-800">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" />
                        <span>
                          {r.name} ({r.ref}): works now{r.note && <span className="text-slate-600">: {r.note}</span>}
                        </span>
                      </li>
                    ))}
                    {waiting.map((r) => (
                      <li key={r.ref} className="flex gap-1.5 text-slate-500">
                        <svg aria-hidden viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="mt-0.5 h-4 w-4 shrink-0">
                          <circle cx="8" cy="8" r="3.5" />
                        </svg>
                        <span>
                          {r.name} ({r.ref}): not yet
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                {/* With something to look at, reopening asks why; otherwise it is one small button. */}
                {fix.failed.length > 0 || newSinceFix > 0 ? (
                  <>
                    {noteField("Why reopen? The testers see this (optional).", 1)}
                    <button disabled={pending} onClick={reopen} className={button("primary")}>
                      <BusyLabel busy={pending} busyText="Saving…">
                        Reopen
                      </BusyLabel>
                    </button>
                  </>
                ) : (
                  <div>
                    <button disabled={pending} onClick={reopen} className={button("secondary", "sm")}>
                      <BusyLabel busy={pending} busyText="Saving…">
                        Reopen
                      </BusyLabel>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <p role="status" className="mt-2 text-meta text-slate-700 empty:hidden">
          {done}
        </p>
        {error && (
          <p role="alert" className="mt-2 text-meta text-red-700">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

/** "Priya, Aoife, Tom and James". */
function listOf(names: string[]): string {
  return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
