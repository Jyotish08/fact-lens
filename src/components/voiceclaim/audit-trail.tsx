import { CheckCircle2, XCircle, Search, FileText, Cpu, ShieldCheck } from "lucide-react";
import type { ContextualResolution, VerificationResult } from "@/lib/voiceclaim/types";

export function AuditTrail({ result, resolution }: { result: VerificationResult; resolution?: ContextualResolution | undefined }) {
  const trace = result.trace;
  const coverage = result.coverage;

  if (!trace && !coverage) return null;

  return (
    <div className="space-y-4 rounded-xl border bg-surface/50 p-4 text-xs">
      <div className="flex items-center justify-between border-b pb-2">
        <span className="font-semibold text-foreground flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-primary" />
          Provenance & Verification Audit Trail
        </span>
        <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-mono text-muted-foreground uppercase">
          Pipeline {result.pipelineVersion ?? "v1"}
        </span>
      </div>

      {resolution && (
        <div className="rounded-lg border border-live/30 bg-live/5 p-3">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Context Resolution Receipt</span>
          <p className="mt-1 text-[11px]">“{resolution.surfaceForm}” → “{resolution.resolvedReferent}” · {Math.round(resolution.confidence * 100)}% confidence</p>
          <p className="mt-1 text-[10px] text-muted-foreground">Antecedent: {resolution.antecedentSegmentId} · {resolution.rationale}</p>
        </div>
      )}

      {/* Coverage & Retrieval Stats */}
      {coverage && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border bg-surface p-2.5">
            <span className="text-[10px] text-muted-foreground uppercase">Queries</span>
            <p className="mt-0.5 font-mono font-semibold">
              {coverage.queriesSucceeded} / {coverage.queriesRequested}
            </p>
          </div>
          <div className="rounded-lg border bg-surface p-2.5">
            <span className="text-[10px] text-muted-foreground uppercase">Pages Scraped</span>
            <p className="mt-0.5 font-mono font-semibold">
              {coverage.pagesRetrieved} / {coverage.pagesAttempted}
            </p>
          </div>
          <div className="rounded-lg border bg-surface p-2.5">
            <span className="text-[10px] text-muted-foreground uppercase">Passages Verified</span>
            <p className="mt-0.5 font-mono font-semibold">
              {coverage.passagesVerified}
            </p>
          </div>
          <div className="rounded-lg border bg-surface p-2.5">
            <span className="text-[10px] text-muted-foreground uppercase">Calibration</span>
            <p className="mt-0.5 font-mono font-semibold">
              {result.calibration?.status === "calibrated" ? "Calibrated" : "Uncalibrated"}
            </p>
          </div>
        </div>
      )}

      {/* Decision Receipt */}
      {trace?.decision && (
        <div className="rounded-lg border bg-surface p-3 space-y-2">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <Cpu className="size-3" />
            Decision Receipt
          </span>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
            <span>
              Support (S): <strong className="text-verdict-supported">{trace.decision.support.toFixed(3)}</strong>
            </span>
            <span>
              Contradiction (C): <strong className="text-verdict-contradicted">{trace.decision.contradiction.toFixed(3)}</strong>
            </span>
            <span>
              Thresholds: <strong className="text-foreground">{trace.decision.thresholdsVersion}</strong>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
            <span className="text-muted-foreground">Rules Fired:</span>
            {trace.decision.rulesFired.map((rf) => (
              <span key={rf} className="rounded bg-muted px-1.5 py-0.5 font-mono font-medium text-foreground">
                {rf}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Retrieval Events */}
      {trace?.retrievalEvents && trace.retrievalEvents.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            Retrieval Events ({trace.retrievalEvents.length})
          </span>
          <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-lg border bg-surface p-2">
            {trace.retrievalEvents.map((evt) => (
              <div key={evt.id} className="flex items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-1.5 truncate">
                  {evt.status === "ok" ? (
                    <CheckCircle2 className="size-3 text-verdict-supported shrink-0" />
                  ) : (
                    <XCircle className="size-3 text-verdict-contradicted shrink-0" />
                  )}
                  {evt.kind === "search" ? (
                    <Search className="size-3 text-muted-foreground shrink-0" />
                  ) : (
                    <FileText className="size-3 text-muted-foreground shrink-0" />
                  )}
                  <span className="truncate font-mono text-muted-foreground">
                    {evt.query || evt.url}
                  </span>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground/70 font-mono">
                  {evt.durationMs}ms
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prompt Registry Versions */}
      {trace?.promptVersions && (
        <div className="flex flex-wrap gap-2 pt-1 border-t text-[10px] text-muted-foreground font-mono">
          {Object.entries(trace.promptVersions).map(([key, ver]) => (
            <span key={key}>
              {key}: {ver}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
