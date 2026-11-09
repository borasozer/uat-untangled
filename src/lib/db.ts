import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

/**
 * Every read and write goes through db(): one Supabase client per server process, made on first use with the secret key.
 * Runs on the server only: the browser never talks to the database, and row level security is on for every table.
 * must() treats a missing result as a failure too, which is why the writes wrapped in it end in .select().
 */

let client: SupabaseClient | null = null;

/** Server-side Supabase client using the secret key. Never import from client components. */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseSecretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** A database failure. Its message is technical, so the app shows a plain one instead (see app/actions.ts). */
export class DbError extends Error {}

/** Unwraps a Supabase response, throwing on error so failures are never silent. */
export function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new DbError(`${what}: ${res.error.message}`);
  if (res.data === null) throw new DbError(`${what}: no data`);
  return res.data;
}
