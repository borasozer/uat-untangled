"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startOverAction } from "@/app/actions";
import { BusyLabel } from "./ui/busy-label";

/**
 * "Start the demo over": after one confirming click, the shared demo goes back to its start for everyone. The server does
 * the work (startOverAction, then lib/demo.ts) and makes no AI call: the starting suggestions are saved.
 */

const MESSAGE = {
  done: "The demo is back at the start.",
  already_fresh: "The demo is already at the start.",
  too_soon: "The demo was started over a moment ago. Try again in half a minute.",
};

/**
 * In the footer of every page, and in Review once every report is decided. After a reset, the Overview: the report or
 * ticket open here may no longer exist.
 */
export function ResetDemo() {
  const pathname = usePathname();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (confirming) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span>Clear everything people have done in the demo?</span>
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await startOverAction();
              setConfirming(false);
              setMessage(!r.ok ? r.error : MESSAGE[r.data]);
              if (r.ok && r.data === "done" && pathname !== "/") router.push("/");
            })
          }
          className="rounded border border-slate-300 px-2 py-0.5 text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          <BusyLabel busy={pending} busyText="Starting over…">
            Start over
          </BusyLabel>
        </button>
        <button onClick={() => setConfirming(false)} className="px-2 py-0.5 hover:underline">
          Cancel
        </button>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-3">
      <button onClick={() => setConfirming(true)} className="text-accent hover:underline">
        Start the demo over
      </button>
      {message && <span className="text-slate-700">{message}</span>}
    </span>
  );
}
