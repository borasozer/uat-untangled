import type { ReactNode } from "react";

/**
 * One switch for the role icons: in the header's view switch, on the Overview's steps and in the "How it's built"
 * drawing. Set it to false and they all go; the drawing falls back to plain figures.
 */
export const ROLE_ICONS = true;

/** What has an icon: the three people, the Overview and the AI. Wider than a person's role in lib/types.ts. */
export type Role = "overview" | "tester" | "manager" | "developer" | "ai";

/**
 * 24×24 line drawings in the app's icon style: the loop for the Overview, a test script with a tick, an approval
 * stamp, code, and three cards for the AI's three separate runs. The parts that move in a short gesture carry an `ri-`
 * class (globals.css): the tick is drawn again, the stamp presses, `<` and `>` move apart, the cards spread; the
 * Overview's loop turns as a whole. At rest they look the same as one drawing.
 */
export const ROLE_PATHS: Record<Role, ReactNode> = {
  overview: (
    <>
      <path d="M4.5 12a7.5 7.5 0 0 1 13.2-4.9M19.5 12a7.5 7.5 0 0 1-13.2 4.9" />
      <path d="M18 3.5v3.8h-3.8M6 20.5v-3.8h3.8" />
    </>
  ),
  tester: (
    <>
      <path d="M9 4.5H7.5a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2H15" />
      <rect x="9" y="3" width="6" height="3.2" rx="1" />
      <path className="ri-tick" pathLength={1} d="M9 13.4l2.1 2.1 4-4.2" />
    </>
  ),
  manager: (
    <>
      <g className="ri-stamp">
        <path d="M12 3.2a2.6 2.6 0 0 1 2.6 2.6c0 1.5-1 2.3-1.4 3.7h-2.4c-.4-1.4-1.4-2.2-1.4-3.7A2.6 2.6 0 0 1 12 3.2z" />
        <path d="M5.5 13.2a2.7 2.7 0 0 1 2.7-2.7h7.6a2.7 2.7 0 0 1 2.7 2.7v2.3h-13z" />
      </g>
      <path d="M4.5 19.5h15" />
    </>
  ),
  developer: (
    <>
      <path className="ri-lt" d="M8 7.5L3.5 12 8 16.5" />
      <path className="ri-gt" d="M16 7.5l4.5 4.5-4.5 4.5" />
      <path d="M13.6 5l-3.2 14" />
    </>
  ),
  ai: (
    <>
      <rect className="ri-back" x="8" y="2.5" width="13" height="10" rx="1.6" fill="#fff" />
      <rect x="5.5" y="6" width="13" height="10" rx="1.6" fill="#fff" />
      <g className="ri-front">
        <rect x="3" y="9.5" width="13" height="10" rx="1.6" fill="#fff" />
        <path d="M6 13.5h7M6 16.5h4.5" />
      </g>
    </>
  ),
};

export function RoleIcon({ role, className = "h-4 w-4" }: { role: Role; className?: string }) {
  if (!ROLE_ICONS) return null;
  return (
    <svg
      aria-hidden
      data-role={role}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {ROLE_PATHS[role]}
    </svg>
  );
}
