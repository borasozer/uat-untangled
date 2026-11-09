/** The one mark used wherever something comes from the AI. */
export function AiTag({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded border border-accent/35 px-1 text-[11px] leading-4 font-semibold tracking-wide text-accent ${className}`}
    >
      AI
    </span>
  );
}
