"use client";

import { usePathname, useRouter } from "next/navigation";
// The kind `router.prefetch` takes for a whole page; Next.js does not export it anywhere else.
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";

/**
 * Every page is rendered fresh, so a plain link fetches nothing before the click and the page takes a moment to come.
 * The header's links are the ones people move between all the time: for them the page is fetched whole as soon as a
 * mouse points at the link (or a finger or the keyboard reaches it), so it is usually there by the click; a click
 * before it is there waits for the same fetch. Never for the page already open. A page fetched this way is used for 30
 * seconds at most (next.config.ts, `staleTimes`), and dropped at once when anything is changed (every change ends with
 * `revalidatePath("/", "layout")`, actions.ts).
 *
 * Spread `fetchOnIntent(href)` into each `<Link>`. The link itself is left as it is (set up again while its page is on
 * the way, it would lose its "on the way" state).
 */
export function useFetchOnIntent() {
  const router = useRouter();
  const pathname = usePathname();
  return (href: string) => {
    const intent = () => {
      if (href !== pathname) router.prefetch(href, { kind: PrefetchKind.FULL });
    };
    return { onMouseEnter: intent, onFocus: intent, onTouchStart: intent };
  };
}
