import type { Metadata } from "next";
import { Suspense } from "react";
import { Nav, type NavPerson } from "@/components/nav";
import { ResetDemo } from "@/components/reset-demo";
import { Tour } from "@/components/tour/tour";
import { GitHubMark } from "@/components/ui/icons";
import { architectureFacts } from "@/lib/architecture-facts";
import { getCycle, getPeople } from "@/lib/queries";
import "./globals.css";

/**
 * The frame of every page: the header (Nav), the page, the footer and the tour, which sits above them all. The header's
 * people and the footer's app and cycle come from the database; neither stops a page loading if it cannot be reached.
 * The facts for "How it's built" (model, spend limits, sample figures) are read here, on the server, because the header
 * runs in the browser.
 */

export const metadata: Metadata = {
  title: { default: "Untangle", template: "%s · Untangle" },
  description: "UAT feedback triage. The AI suggests, a person decides each report.",
};

/** The code, in a public repository. */
const REPO = "https://github.com/borasozer/uat-untangled";

/** The people the header can show. The page still loads if the database cannot be reached. */
async function navPeople(): Promise<{ testers: NavPerson[]; manager: NavPerson | null; developer: NavPerson | null }> {
  try {
    const people = await getPeople();
    const pick = (p: (typeof people)[number]): NavPerson => ({ id: p.id, name: p.name, team: p.team });
    const manager = people.find((p) => p.role === "manager");
    const developer = people.find((p) => p.role === "developer");
    return {
      testers: people.filter((p) => p.role === "tester").map(pick),
      manager: manager ? pick(manager) : null,
      developer: developer ? pick(developer) : null,
    };
  } catch (e) {
    console.error("Header could not load people", e);
    return { testers: [], manager: null, developer: null };
  }
}

/** "MedInfo Assist v2.3 · UAT Cycle 3": the app under test comes from the data, never from the code. */
async function cycleLine(): Promise<string | null> {
  try {
    const cycle = await getCycle();
    return cycle ? `${cycle.app_name} · ${cycle.name}` : null;
  } catch (e) {
    console.error("Footer could not load the cycle", e);
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [people, cycle] = await Promise.all([navPeople(), cycleLine()]);
  return (
    <html lang="en-GB" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans text-[15px]">
        <Suspense fallback={<div className="h-14 border-b border-slate-200 bg-white" />}>
          <Nav {...people} facts={architectureFacts()} />
        </Suspense>
        {/* A column, so a page can sit in the middle of the screen (the Overview does on a wide screen). */}
        <main className="flex flex-1 flex-col">{children}</main>
        <footer className="border-t border-slate-200 text-xs text-slate-500">
          <div className="app-container flex flex-wrap items-center justify-between gap-x-6 gap-y-1 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p>One demo, shared by everyone with the link. It starts over after an hour without use.</p>
              <ResetDemo />
            </div>
            <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span>{cycle ? `${cycle} · all fictional` : "All fictional"}</span>
              <span aria-hidden>·</span>
              <span>Built by Bora Sozer</span>
              <span aria-hidden>·</span>
              <a
                href={REPO}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                <GitHubMark className="h-3.5 w-3.5" />
                GitHub
              </a>
            </p>
          </div>
        </footer>
        {/* Above the page, outside it: while the tour runs, the header, the page and the footer are made inert. */}
        <Tour />
      </body>
    </html>
  );
}
