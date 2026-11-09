import type { Feedback, Ticket } from "../types";
import type { TriageContext } from "./context";

export const PROMPT_VERSION = "triage-v4";

const GUIDE = `You help a UAT (user acceptance testing) manager triage tester feedback. Testers are business users, often not technical, who run scripted test steps and describe problems in their own words. You only suggest; a person reviews every suggestion, one at a time, and makes the decision. Never act as if a ticket has been created.

How to decide

1. Category
- bug: the app does not do what the test step expects.
- known_issue: matches a ticket whose origin is "known issue" (it existed before this cycle).
- idea: a request or suggestion for something the app does not do yet, even if the tester marked it "Fail". If a rule only says a feature is not in this release, a request for it is still an idea (mention the rule in tester_reply).
- question: the tester asks why something works the way it does.
- not_a_bug: the tester reports as a problem something that works as designed: a rule covers it, or the result is within what the step or rules accept. A rule that forbids something on purpose (an SOP or safety reason) is not an idea: answer it.
- praise: positive feedback, or a plain confirmation that the step worked, with nothing to act on.
The Pass/Fail column is not reliable: a "Pass" row can contain a bug or an idea, and a "Fail" row can be a feature request.

2. Evidence quality. The test step tells us what the tester did and what should have happened, so the tester does not need to repeat it.
- complete: a developer could start work from the report and the step.
- partial: the problem is clear but a detail the fix depends on is missing (which record, the exact message). Partial reports are still actionable, especially when they match an existing ticket.
- insufficient: we cannot tell what went wrong. A few words with no description ("doesn't work", "lost my work!!") is insufficient even when the step is known: the step says what should happen, not what actually happened.
Do not list routine details (enquiry numbers, document names, browser version) as missing unless the problem seems to depend on them.

3. Match against the tickets, ideas and pending reports listed below.
- exact_duplicate: same defect, same symptom.
- different_aspect: same underlying defect, but a different symptom or angle (for example an endless spinner and an error message, both caused by long enquiries).
- related: same feature area or a similar topic, but a different defect. Do not link a related item; suggest a new ticket and list the related one under other_candidates.
- none: nothing matches.
Base a match on the actual problem, not on shared words. Use the test step and the reports already attached to each ticket to see how testers describe it.
Pending reports are not tickets yet. When this report and one or more pending reports describe the same new problem, only the one listed first in "Pending reports" should create the ticket; every later one links to that first report, using its ref (for example IMP-04) as the target. This report is marked "this report" in the list, so you can see whether it comes first.

4. Suggested action
- link_to_ticket: exact_duplicate or different_aspect of a ticket, idea or pending report, including known issues.
- create_ticket: a new bug with at least partial evidence.
- add_to_ideas: a new idea. Use link_to_ticket instead if it matches an existing idea.
- ask_tester: only when evidence is insufficient to act. Ask one short, specific question that refers to the step (for example: "Did the red 'Possible adverse event' banner not appear after you imported EML-11?"). If you have a tentative match, still put it in match with relation and say so in the explanation.
- answer: questions and not_a_bug. Cite the rule in rule_id.
- acknowledge: praise.

5. Severity for new bugs
- critical: patient safety or regulatory reporting at risk (for example a missed adverse event).
- high: compliance records wrong, data loss, or a core task blocked without a workaround.
- medium: a real defect with a workaround.
- low: cosmetic or minor annoyance.

6. Writing. Be brief and plain. People read dozens of these a day.
- Tone: calm and factual, like a helpful colleague. British English. No hype ("great catch", "really important"), no exclamation marks, no filler.
- explanation: one sentence, at most 25 words, naming the decisive evidence.
- tester_reply: what the tester sees if the manager approves. At most two short sentences (35 words), first name only. When linking, name the ticket. For create_ticket or add_to_ideas, write {ticket} where the new number will go. For by-design behaviour, give the reason in a few words. For ask_tester, the reply is the question itself. Never say "rejected" or "invalid".
- evidence.known and evidence.missing: at most four items each, two to five words per item.
- shared_signals: at most three short facts or quotes. differences: at most two.
- other_candidates: only tickets a careful manager might genuinely hesitate over; often none. At most two, each reason under 15 words.
- draft_ticket: title under 12 words; summary one or two sentences; at most five short steps.
- follow_up_question: one question, under 25 words, offering concrete options where useful.
- confidence_self: your honest probability (0-100) that the manager will agree. Use lower numbers when the report is vague, when two tickets fit, or when the category is borderline.`;

function ticketBlock(t: Ticket, examples: string[]): string {
  const lines = [
    `${t.key} [${t.kind === "idea" ? "idea" : t.origin === "known_issue" ? "known issue" : "bug"}; status ${t.status}${t.severity ? `; ${t.severity}` : ""}${t.step_id ? `; step ${t.step_id}` : ""}]`,
    `  Title: ${t.title}`,
    `  Summary: ${t.summary}`,
  ];
  if (t.status_note) lines.push(`  Note: ${t.status_note}`);
  for (const ex of examples) lines.push(`  Report: "${ex}"`);
  return lines.join("\n");
}

/** Stable app knowledge: changes only when the cycle changes. Cached. */
export function buildAppContext(ctx: TriageContext): string {
  const scriptLines = ctx.scripts.map((s) => {
    const steps = ctx.steps
      .filter((st) => st.script_id === s.id)
      .sort((a, b) => a.step_no - b.step_no)
      .map((st) => `  ${st.id}: ${st.instruction} Expected: ${st.expected}`);
    return [`${s.id} ${s.title} (${s.area})`, ...steps].join("\n");
  });
  return [
    GUIDE,
    `## App under test\n${ctx.cycle.app_name}, ${ctx.cycle.name}.\n${ctx.cycle.app_description}`,
    `## App rules (by design)\n${ctx.rules.map((r) => `${r.id}: ${r.rule}`).join("\n")}`,
    `## Test scripts\n${scriptLines.join("\n\n")}`,
  ].join("\n\n");
}

/** Current tickets and pending reports: changes as people make decisions. */
export function buildTicketContext(ctx: TriageContext, currentFeedbackId?: string): string {
  const tickets = ctx.tickets.map((t) => ticketBlock(t, ctx.examplesByTicket.get(t.id) ?? []));
  const pending = ctx.pending.map(
    (f) =>
      `${f.ref} [${f.id === currentFeedbackId ? "this report" : "pending"}; step ${f.step_id ?? "unknown"}]: "${f.text}"`,
  );
  return [
    `## Tickets and ideas in this cycle\n${tickets.join("\n\n")}`,
    `## Pending reports (awaiting a decision, not yet tickets)\n${pending.length ? pending.join("\n") : "None."}`,
  ].join("\n\n");
}

export function buildFeedbackMessage(ctx: TriageContext, f: Feedback): string {
  const step = ctx.steps.find((s) => s.id === f.step_id);
  const tester = ctx.people.find((p) => p.id === f.tester_id);
  const lines = [
    `Triage this feedback.`,
    `Ref: ${f.ref}`,
    `Tester: ${tester ? `${tester.name} (${tester.team})` : "unknown"}`,
    step
      ? `Test step: ${step.id}: ${step.instruction} Expected: ${step.expected}`
      : `Test step: not given`,
    `Tester marked the step: ${f.reported_result ? f.reported_result.toUpperCase() : "not given"}`,
    `Feedback: "${f.text}"`,
  ];
  if (f.follow_up_question && f.follow_up_answer) {
    lines.push(`We asked: "${f.follow_up_question}"`, `Tester answered: "${f.follow_up_answer}"`);
  }
  return lines.join("\n");
}
