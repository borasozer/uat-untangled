import { env } from "@/lib/env";
import { InfoTip } from "@/components/ui/info-tip";
import { getBatchSummary, getPeople, getStepIds } from "@/lib/queries";
import { Importer } from "./importer";

/**
 * Import (Manager → Import): a test run exported as a spreadsheet becomes reports, each analysed by the AI and then decided
 * one by one in Review. This server part only reads; Importer does the work in the browser.
 */

export const dynamic = "force-dynamic";
export const metadata = { title: "Import" };

/**
 * The import screen, with the last import, the step ids and the people as names only (a sheet names its testers; the
 * check matches by name).
 */
export default async function ImportPage() {
  // The last import, so what it became can be seen again without importing (and paying) twice. People and steps let
  // the screen check an uploaded sheet before anything is created.
  const [last, people, steps] = await Promise.all([getBatchSummary(), getPeople(), getStepIds()]);
  const times = env.aiSamples === 1 ? "once" : `${env.aiSamples} times`;
  return (
    <div className="app-container flex flex-col gap-4 py-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-title font-semibold text-slate-900">Import a spreadsheet</h1>
        <p className="text-meta text-slate-600">
          The AI reads every row {times}, rows marked Pass too, and groups rows about one problem. Nothing becomes a ticket
          until you approve it in Review.
          <InfoTip inline label="Rows marked Pass" text="A row marked Pass can still describe a bug or an idea." />
        </p>
      </div>
      <Importer last={last} people={people.map((p) => p.name)} steps={steps} />
    </div>
  );
}
