import { db } from "@/lib/db";

/** Run on every call, never answered from a copy made at build time: each cron call must reach the database. */
export const dynamic = "force-dynamic";

/**
 * Called once a day by a Vercel cron (vercel.json). One small read keeps the free Supabase project from pausing
 * after a quiet week, so the live link still works when someone opens it later. It reads only; nothing changes.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  // Vercel's cron sends CRON_SECRET as a bearer token when the project has one. Without it the route is open: it only reads.
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { error } = await db().from("cycles").select("id").limit(1);
  // A failed read must show as failed in Vercel's cron log, or the database could pause unnoticed.
  return Response.json({ ok: !error }, { status: error ? 500 : 200 });
}
