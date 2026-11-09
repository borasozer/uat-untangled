import { analyseAndStore } from "@/lib/ai/analyse";
import { BudgetError, clientId } from "@/lib/ai/budget";
import { db, DbError } from "@/lib/db";

// Analysing one item makes several Claude calls in parallel; allow time for slow responses.
export const maxDuration = 120;

/** Analyses one newly imported feedback item. Called once per item so the import screen can show progress. */
export async function POST(request: Request) {
  let feedbackId: unknown;
  try {
    ({ feedbackId } = await request.json());
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof feedbackId !== "string" || !/^[0-9a-f-]{36}$/i.test(feedbackId)) {
    return Response.json({ error: "feedbackId must be a UUID." }, { status: 400 });
  }
  const exists = await db().from("feedback").select("id, status").eq("id", feedbackId).maybeSingle();
  if (!exists.data) return Response.json({ error: "Feedback not found." }, { status: 404 });
  // Only reports still waiting for their first analysis: nothing can be re-analysed over and over.
  if (exists.data.status !== "new") {
    return Response.json({ error: "This report has already been analysed." }, { status: 409 });
  }

  try {
    const analysisId = await analyseAndStore(feedbackId, { client: clientId(request.headers) });
    return Response.json({ analysisId });
  } catch (e) {
    if (e instanceof BudgetError) return Response.json({ error: e.message }, { status: 429 });
    console.error(e);
    const plain = e instanceof Error && !(e instanceof DbError);
    return Response.json({ error: plain ? e.message : "the analysis did not finish" }, { status: 502 });
  }
}
