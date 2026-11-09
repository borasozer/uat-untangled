import { ensureFreshDemo } from "@/lib/demo";
import { getCycle, getPeople, getScriptsWithSteps, getTesterFeedback } from "@/lib/queries";
import { TesterApp } from "./tester-app";

/**
 * The tester's page, /tester. `?as=` says which tester (the header's "You are" menu; there is no sign-in), the first
 * tester otherwise. On the server it starts the shared demo over if it was left changed and idle, loads that tester's
 * reports, the test scripts with their steps and the cycle, and hands them to TesterApp.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "New report" };
// The AI review starts after the report is saved; give it time to finish.
export const maxDuration = 120;

export default async function TesterPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  await ensureFreshDemo();
  const { as } = await searchParams;
  const [people, scripts, cycle] = await Promise.all([getPeople(), getScriptsWithSteps(), getCycle()]);
  const testers = people.filter((p) => p.role === "tester");
  const me = testers.find((t) => t.id === as) ?? testers[0];
  const manager = people.find((p) => p.role === "manager")?.name ?? null;
  const names = Object.fromEntries(people.map((p) => [p.id, p.name]));
  const mine = me ? await getTesterFeedback(me.id) : [];
  // Switching tester starts a fresh form.
  return <TesterApp key={me?.id} me={me} manager={manager} names={names} scripts={scripts} mine={mine} cycle={cycle} />;
}
