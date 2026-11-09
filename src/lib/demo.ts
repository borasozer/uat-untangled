import { db, DbError } from "./db";
import { resetDemo, SEED_BASELINE } from "./seed";

/**
 * The public demo is one shared workspace. Anyone can start it over, and it starts over by itself
 * after an hour without use, so a later visitor finds it as it was meant to be seen.
 */
const IDLE_MS = 60 * 60 * 1000;
/** Ignore a second "start over" right after one: protects against double clicks and scripted resets. */
const COOLDOWN_MS = 30 * 1000;
/** How often one server checks whether the demo has been left idle. */
const CHECK_EVERY_MS = 60 * 1000;
/**
 * A reset empties the tables for a few seconds (about 3). Rows missing may mean one is under way elsewhere, on
 * another server or from a script: wait this long and look again before treating the demo as broken.
 */
const BROKEN_RECHECK_MS = 8 * 1000;

let resetting: Promise<void> | null = null;
let lastCheck = 0;

/**
 * The demo as the database shows it. resetAt: when it was last started over; lastActivity: when anyone last used it
 * (a reset counts). Both are times in ms, null when no row says.
 */
export type DemoState = {
  /** Someone has used the demo since the last reset. */
  changed: boolean;
  /** Fewer rows than a fresh demo in any table: a reset is under way, or one was interrupted. */
  broken: boolean;
  resetAt: number | null;
  lastActivity: number | null;
};

/**
 * Reads DemoState: row counts against a fresh demo (SEED_BASELINE), the oldest suggestion's date and the newest rows'.
 */
async function demoState(): Promise<DemoState> {
  const supabase = db();
  const count = async (table: string) => {
    const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });
    if (error) throw new DbError(`count ${table}: ${error.message}`);
    return count ?? 0;
  };
  const time = async (table: string, column: string, { first = false, source }: { first?: boolean; source?: string } = {}) => {
    let query = supabase.from(table).select(column).order(column, { ascending: first }).limit(1);
    if (source) query = query.eq("source", source);
    const { data, error } = await query;
    if (error) throw new DbError(`read ${table}: ${error.message}`);
    const value = (data?.[0] as unknown as Record<string, string> | undefined)?.[column];
    return value ? Date.parse(value) : null;
  };

  const [feedback, decisions, analyses, ticketEvents, resetAt, ...activity] = await Promise.all([
    count("feedback"),
    count("decisions"),
    count("analyses"),
    count("ticket_events"),
    // A reset restores the saved suggestions last, so the oldest analysis marks when it happened.
    time("analyses", "created_at", { first: true }),
    time("analyses", "created_at"),
    time("decisions", "decided_at"),
    time("batches", "created_at"),
    // A developer's or a tester's action on a ticket (the seeded events are dated in the past).
    time("ticket_events", "at"),
    // Imported rows carry the spreadsheet's dates, so only reports sent from the app count here.
    time("feedback", "submitted_at", { source: "tester_app" }),
  ]);
  const times = activity.filter((t): t is number => t !== null);
  return {
    changed:
      feedback !== SEED_BASELINE.feedback ||
      decisions !== SEED_BASELINE.decisions ||
      analyses !== SEED_BASELINE.analyses ||
      ticketEvents !== SEED_BASELINE.ticketEvents,
    // Only a reset deletes rows, and it writes reports, then decisions, then the saved suggestions last, each table in
    // one go: a table short of the fresh demo means one is under way or was cut off, not that someone used it.
    // Suggestions count only when there are none at all, since `npm run analyse:pending` adds them one by one. A
    // deliberate `npm run seed -- --fresh` looks the same and is put back too: run it and `analyse:pending` back to
    // back, while nobody is using the live demo.
    broken:
      feedback < SEED_BASELINE.feedback ||
      decisions < SEED_BASELINE.decisions ||
      ticketEvents < SEED_BASELINE.ticketEvents ||
      (SEED_BASELINE.analyses > 0 && analyses === 0),
    resetAt,
    lastActivity: times.length ? Math.max(...times) : null,
  };
}

/** The demo's state; if rows are missing, the state a moment later, so a reset in progress is not mistaken for a broken one. */
async function settledState(): Promise<DemoState> {
  const state = await demoState();
  if (!state.broken) return state;
  await new Promise((r) => setTimeout(r, BROKEN_RECHECK_MS));
  return demoState();
}

/** Whether a page load should start the demo over: it was left changed and idle, or a reset was interrupted. */
export function shouldStartOver(state: DemoState, now: number): boolean {
  const idleFor = state.lastActivity === null ? Infinity : now - state.lastActivity;
  return state.broken || (state.changed && idleFor > IDLE_MS);
}

/**
 * done: started over, or waited for a reset already under way on this server; already_fresh: nothing to undo;
 * too_soon: the last reset was under 30 seconds ago (a broken demo is started over anyway).
 */
export type StartOverResult = "done" | "already_fresh" | "too_soon";

/** Puts the demo back to its starting state. `known`: the settled state the caller has just read, so it is not waited for twice. */
export async function startOver(known?: DemoState): Promise<StartOverResult> {
  if (resetting) {
    await resetting;
    return "done";
  }
  const state = known ?? (await settledState());
  if (!state.changed) return "already_fresh";
  if (!state.broken && state.resetAt && Date.now() - state.resetAt < COOLDOWN_MS) return "too_soon";

  resetting = (async () => {
    try {
      await resetDemo();
    } catch (e) {
      // Another server may have been resetting at the same moment: wait, then start once more from scratch.
      console.error("Demo reset failed, retrying", e);
      await new Promise((r) => setTimeout(r, 2000));
      await resetDemo();
    } finally {
      resetting = null;
    }
  })();
  await resetting;
  return "done";
}

/**
 * Called before a page loads its data: starts the demo over if it was left changed and idle.
 * DEMO_AUTORESET=off turns this off, for a local server that shares the live database and must only read.
 */
export async function ensureFreshDemo(): Promise<void> {
  if (process.env.DEMO_AUTORESET === "off") return;
  // A reset that failed is logged where it ran; the page still loads.
  if (resetting) return resetting.catch(() => {});
  if (Date.now() - lastCheck < CHECK_EVERY_MS) return;
  lastCheck = Date.now();
  try {
    const state = await settledState();
    if (shouldStartOver(state, Date.now())) await startOver(state);
  } catch (e) {
    console.error("Demo freshness check failed", e); // never stop a page from loading
  }
}
