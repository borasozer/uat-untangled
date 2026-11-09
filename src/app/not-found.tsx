import Link from "next/link";
import { button } from "@/components/ui/button";

export const metadata = { title: "Not found" };

/**
 * An unknown address, or a ticket that is no longer there (tickets/[key]/page.tsx sends a missing one here; someone may have
 * started the shared demo over). Next.js shows it inside the usual frame (layout.tsx).
 */
export default function NotFound() {
  return (
    <div className="app-container flex flex-col gap-3 py-10">
      <h1 className="text-title font-semibold text-slate-900">This page isn&apos;t here</h1>
      <p className="max-w-xl text-sm text-slate-600">
        It may be a ticket or report that is no longer in the demo: everyone shares one demo, and anyone can start it over.
      </p>
      <div className="mt-2 flex gap-2">
        <Link href="/tickets" className={button("secondary")}>
          Tickets
        </Link>
        <Link href="/" className={button("secondary")}>
          Overview
        </Link>
      </div>
    </div>
  );
}
