import { AlertTriangle, ChevronRight, Quote } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CLAIM_STAGE_LABELS,
  REASON_LABELS,
  formatTimestamp,
  isTerminal,
  type AtomicClaim,
} from "@/lib/voiceclaim/types";
import { StageRail } from "./stage-rail";
import { VerdictBadge, verdictAccent } from "./verdict";

export function ClaimCard({
  claim,
  onOpen,
  onRetry,
}: {
  claim: AtomicClaim;
  onOpen: () => void;
  onRetry?: () => void;
}) {
  const terminal = isTerminal(claim.state);
  const supporting = claim.evidence.filter((e) => e.relation === "supports").length;
  const contradicting = claim.evidence.filter((e) => e.relation === "contradicts").length;

  return (
    <article className="group editorial-card relative overflow-hidden rounded-xl transition-all hover:-translate-y-px hover:border-foreground/20 hover:shadow-md">
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-[3px]",
          verdictAccent(claim.result?.verdict, claim.state),
        )}
      />
      <button type="button" onClick={onOpen} className="w-full cursor-pointer p-5 pl-6 text-left">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
            <span className="tabular">{formatTimestamp(claim.timestampMs)}</span>
            {claim.manual && <span className="text-foreground">Manual</span>}
            {!terminal && (
              <span className="inline-flex items-center gap-1.5 text-live">
                <span className="size-1.5 animate-pulse rounded-full bg-live" />
                {CLAIM_STAGE_LABELS[claim.state]}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <VerdictBadge verdict={claim.result?.verdict} state={claim.state} />
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
        </div>

        <p className="mt-4 flex gap-2 text-xs leading-relaxed text-muted-foreground sm:text-[13px]">
          <Quote className="mt-0.5 size-3 shrink-0" />
          <span className="italic">"{claim.originalText}"</span>
        </p>

        <p className="mt-3 font-display text-[15px] leading-snug font-semibold">
          {claim.normalizedClaim}
        </p>
        {claim.resolution && (
          <p className="mt-2 rounded-md border border-live/25 bg-live/5 px-2.5 py-1.5 text-xs text-muted-foreground">
            Understood as: <span className="font-medium text-foreground">{claim.normalizedClaim}</span>
          </p>
        )}

        {!terminal && (
          <div className="mt-4 space-y-3">
            <StageRail state={claim.state} />
            {claim.evidence.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {claim.evidence.length} source
                {claim.evidence.length === 1 ? "" : "s"} retrieved so far — partial, not a verdict.
              </p>
            )}
          </div>
        )}

        {claim.state === "VERIFICATION_ERROR" && (
          <div className="mt-4 flex gap-2 rounded-lg border border-verdict-error/40 bg-verdict-error/10 p-3 text-xs leading-relaxed">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-verdict-error" />
            <span>{claim.error}</span>
          </div>
        )}

        {terminal && claim.result && claim.state !== "VERIFICATION_ERROR" && (
          <div className="mt-4 space-y-3">
            <div className="flex items-end justify-between gap-3 border-t pt-4">
              <span className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                Evidence confidence
              </span>
              <span className="tabular font-display text-2xl font-semibold">
                {claim.result.confidence.score}
                <span className="text-sm text-muted-foreground">%</span>
              </span>
            </div>
            {claim.result.reasonCode && REASON_LABELS[claim.result.reasonCode] && (
              <p className="text-xs font-medium text-foreground/90 bg-muted/50 rounded-md px-2.5 py-1.5 border border-border/50">
                {REASON_LABELS[claim.result.reasonCode]}
              </p>
            )}
            <p className="text-sm leading-relaxed text-muted-foreground">{claim.result.summary}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>{supporting} supporting</span>
              <span>{contradicting} contradictory</span>
              <span>
                {claim.result.roundsRun} research round{claim.result.roundsRun === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        )}
      </button>

      {claim.state === "VERIFICATION_ERROR" && onRetry && (
        <div className="border-t px-6 py-3">
          <button
            type="button"
            onClick={onRetry}
            className="cursor-pointer text-xs font-semibold text-foreground hover:underline"
          >
            Retry verification
          </button>
        </div>
      )}
    </article>
  );
}
