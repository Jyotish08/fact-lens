import { cn } from "@/lib/utils";

/** Waveform reading into a verification tick — the product's identity mark. */
export function VoiceClaimMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" className="fill-elevated" />
      <g className="stroke-foreground" strokeWidth="1.9" strokeLinecap="round">
        <path d="M8 13v6" />
        <path d="M12 10v12" />
        <path d="M16 12.5v7" />
      </g>
      <path
        d="M19.5 16.6l2.6 2.7 5-6"
        className="stroke-live"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <VoiceClaimMark />
      <span className="font-display text-[15px] font-semibold tracking-tight">
        Fact Lens
      </span>
    </span>
  );
}
