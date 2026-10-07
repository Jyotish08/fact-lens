import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import {
  CheckCircle2,
  FileText,
  History,
  LoaderCircle,
  Radio,
  SlidersHorizontal,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ClaimCard } from "@/components/voiceclaim/claim-card";
import { ClaimDetailPanel } from "@/components/voiceclaim/claim-detail";
import { TranscriptPane } from "@/components/voiceclaim/transcript-pane";
import { SCENARIOS, getScenarioForMode } from "@/lib/voiceclaim/data/scenarios";
import { SessionEngine } from "@/lib/voiceclaim/engine/session-engine";
import { DEFAULT_SETTINGS, loadSettings, localHistory, takeLaunch } from "@/lib/voiceclaim/history";
import { assetRepository } from "@/lib/voiceclaim/storage";
import { toast } from "sonner";
import {
  MODE_LABELS,
  formatTimestamp,
  isTerminal,
  matchesFilter,
  type ClaimFilter,
  type Session,
} from "@/lib/voiceclaim/types";

export const Route = createFileRoute("/session/$sessionId")({
  head: () => ({
    meta: [
      { title: "Live session — Fact Lens" },
      {
        name: "description",
        content:
          "Live transcript on the left, evidence-backed claim verdicts on the right, updating while speech continues.",
      },
      { property: "og:title", content: "Live session — Fact Lens" },
      {
        property: "og:description",
        content: "Claims detected, researched and challenged during a live conversation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SessionPage,
});

const FILTERS: { id: ClaimFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "supported", label: "Supported" },
  { id: "questionable", label: "Questionable" },
  { id: "contradicted", label: "Contradicted" },
  { id: "insufficient", label: "Insufficient" },
];

const PIPELINE = [
  "Listening",
  "Transcribing",
  "Claims detected",
  "Searching evidence",
  "Checking contradictions",
  "Generating verdict",
  "Completed",
] as const;

function pipelineIndex(session: Session) {
  if (session.status === "completed") return PIPELINE.length - 1;
  if (session.status === "processing" && session.claims.every((claim) => isTerminal(claim.state))) {
    return PIPELINE.length - 2;
  }
  if (session.claims.some((claim) => claim.state === "SYNTHESIZING")) return 5;
  if (session.claims.some((claim) => claim.state === "CHALLENGING")) return 4;
  if (session.claims.some((claim) => claim.state === "RESEARCHING")) return 3;
  if (session.claims.length > 0) return 2;
  if (session.segments.length > 0) return 1;
  return 0;
}

const SOURCE_LABEL = {
  microphone: "Microphone",
  audio_upload: "Audio upload",
  video_upload: "MP4 audio track",
} as const;

function SessionPage() {
  const { sessionId } = useParams({ from: "/session/$sessionId" });
  const navigate = useNavigate();
  const engineRef = useRef<SessionEngine | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [filter, setFilter] = useState<ClaimFilter>("all");
  const [openClaimId, setOpenClaimId] = useState<string | null>(null);

  useEffect(() => {
    let engine: SessionEngine | undefined;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const launch = takeLaunch(sessionId);
      if (!launch) {
        toast.error("This session can no longer be resumed. Start a new session.");
        await navigate({ to: "/" });
        return;
      }
      const settings = launch.settings ?? loadSettings() ?? DEFAULT_SETTINGS;
      const scenario =
        SCENARIOS.find((item) => item.id === launch.scenarioId) ??
        getScenarioForMode(settings.mode);
      const mediaAsset = launch.mediaAssetId
        ? await assetRepository.get(launch.mediaAssetId)
        : undefined;
      const corpusAssets = await assetRepository.list(sessionId, "corpus");
      if (cancelled) return;
      engine = new SessionEngine({
        sessionId,
        title: launch.title ?? scenario.title,
        source: launch.source ?? "microphone",
        scenario,
        settings,
        speed: launch.speed ?? 1,
        serviceMode: launch.serviceMode,
        sessionToken: launch.sessionToken,
        mediaFile: mediaAsset?.file,
        customFiles: corpusAssets.map((asset) => asset.file),
        customSources: corpusAssets.flatMap((asset) => (asset.source ? [asset.source] : [])),
      });
      engineRef.current = engine;
      unsubscribe = engine.subscribe(setSession);
      engine.start();
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
      engine?.dispose();
      engineRef.current = null;
    };
  }, [navigate, sessionId]);

  useEffect(() => {
    if (session?.status === "completed") void localHistory.save(session);
  }, [session?.status, session]);

  const claimedSegmentIds = useMemo(
    () => new Set(session?.claims.flatMap((claim) => [...claim.sourceSegmentIds, ...(claim.antecedentSegmentIds ?? [])]) ?? []),
    [session?.claims],
  );

  if (!session) return null;

  const visible = session.claims.filter((c) => matchesFilter(c, filter));
  const active = session.claims.filter((c) => !isTerminal(c.state)).length;
  const openClaim = session.claims.find((c) => c.id === openClaimId);
  const live = session.status !== "completed" && session.status !== "error";
  const currentPipeline = pipelineIndex(session);

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="session-chrome border-b">
        <div className="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-3 px-5 py-2.5 sm:px-7">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold",
                live ? "border-sky-300/35 text-sky-200" : "border-white/15 text-white/70",
              )}
            >
              {live && <span className="size-1.5 animate-pulse rounded-full bg-sky-300" />}
              {session.progress?.label ??
                (session.status === "error"
                  ? "Input error"
                  : session.status === "completed"
                    ? "Session complete"
                    : session.status === "processing"
                      ? "Finishing"
                      : active > 0
                        ? "Verifying"
                        : "Listening")}
            </span>
            <span className="tabular text-sm text-white/60">
              {formatTimestamp(session.durationMs)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/60">
            <span>{MODE_LABELS[session.settings.mode]} mode</span>
            <span>{session.settings.depth === "deep" ? "Deep" : "Quick"} Verify</span>
            <span>{session.settings.sourceCount} sources/round</span>
            <span>{active} outstanding</span>
          </div>
          <div className="ml-auto flex gap-2">
            {live ? (
              <Button
                size="sm"
                className="border border-white/15 bg-white text-slate-800 hover:bg-white/90"
                disabled={session.status === "processing"}
                onClick={() => void engineRef.current?.finish()}
              >
                <Square className="size-3.5" /> Stop
              </Button>
            ) : (
              <Button
                size="sm"
                className="border border-white/15 bg-white text-slate-800 hover:bg-white/90"
                onClick={() => navigate({ to: "/history" })}
              >
                <Radio className="size-3.5" /> View history
              </Button>
            )}
          </div>
        </div>

        <div className="pipeline-scroll overflow-x-auto border-t border-white/10 px-3 sm:px-5">
          <div className="flex min-w-max items-center gap-1 py-2">
            {PIPELINE.map((stage, index) => (
              <span
                key={stage}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors",
                  index === currentPipeline
                    ? "bg-white text-slate-800"
                    : index < currentPipeline
                      ? "text-white/80"
                      : "text-white/45",
                )}
              >
                {stage}
              </span>
            ))}
          </div>
        </div>

        {session.progress && (
          <div
            className="border-t border-white/10 bg-black/10 px-5 py-3 sm:px-7"
            aria-live="polite"
            aria-label="Session progress"
          >
            <div className="flex items-start gap-3">
              {session.progress.stage === "completed" ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" />
              ) : (
                <LoaderCircle
                  className={cn(
                    "mt-0.5 size-4 shrink-0 text-sky-300",
                    session.progress.stage !== "error" && "animate-spin",
                    session.progress.stage === "error" && "text-rose-300",
                  )}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs font-semibold text-white/90">{session.progress.label}</p>
                  {typeof session.progress.percent === "number" && (
                    <span className="tabular text-[11px] font-semibold text-white/65">
                      {Math.round(session.progress.percent)}%
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-white/55">
                  {session.progress.detail}
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                  {typeof session.progress.percent === "number" ? (
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-500",
                        session.progress.stage === "error" ? "bg-rose-300" : "bg-sky-300",
                      )}
                      style={{ width: `${Math.max(2, session.progress.percent)}%` }}
                    />
                  ) : (
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-sky-300" />
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,0.95fr)_minmax(430px,1.1fr)] xl:grid-cols-[240px_minmax(0,1.08fr)_minmax(460px,0.94fr)]">
        <aside className="workspace-panel hidden min-h-0 flex-col border-r bg-elevated/60 xl:flex">
          <div className="space-y-7 overflow-y-auto p-5">
            <section>
              <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                <SlidersHorizontal className="size-3.5" /> Session
              </h2>
              <dl className="mt-4 space-y-2 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Input</dt>
                  <dd className="text-right font-medium">{SOURCE_LABEL[session.source]}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Interval</dt>
                  <dd className="text-right font-medium capitalize">
                    {session.settings.intervalPreset}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Sources / claim</dt>
                  <dd className="text-right font-medium">{session.settings.sourceCount}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Status</dt>
                  <dd className="text-right font-medium capitalize">{session.status}</dd>
                </div>
              </dl>
            </section>

            <section>
              <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                <FileText className="size-3.5" /> Custom sources
              </h2>
              {session.customSources.length === 0 ? (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  None attached to this session.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {session.customSources.map((source) => (
                    <li key={source.id} className="rounded-lg border bg-card p-2.5 text-xs">
                      <p className="truncate font-medium">{source.name}</p>
                      <p className="mt-1 capitalize text-muted-foreground">{source.parserStatus}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          <button
            type="button"
            onClick={() => void navigate({ to: "/history" })}
            className="mt-auto flex cursor-pointer items-center gap-2 border-t px-5 py-4 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <History className="size-3.5" /> Local history
          </button>
        </aside>

        <section className="workspace-panel flex min-h-0 flex-col border-b lg:border-r lg:border-b-0">
          <header className="flex min-h-14 items-center justify-between border-b px-5">
            <h2 className="font-display text-sm font-semibold">Live transcript</h2>
            <span className="text-[11px] text-muted-foreground">
              {session.segments.filter((segment) => !segment.interim).length} statements
            </span>
          </header>
          <div className="min-h-[360px] flex-1 overflow-y-auto lg:min-h-0">
            <TranscriptPane
              segments={session.segments}
              claimedSegmentIds={claimedSegmentIds}
              live={live}
              onVerify={(id) => void engineRef.current?.verifySegmentManually(id)}
            />
          </div>
        </section>

        <section className="flex min-h-0 flex-col bg-elevated/55">
          <header className="flex min-h-14 flex-wrap items-center gap-2 border-b px-5 py-2.5">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={cn(
                  "cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  filter === item.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-muted-foreground">
              {session.claims.length} atomic claim
              {session.claims.length === 1 ? "" : "s"}
            </span>
          </header>

          <div className="min-h-[360px] flex-1 space-y-3 overflow-y-auto p-4 lg:min-h-0 lg:p-5">
            {visible.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {session.claims.length === 0
                  ? "No verifiable claims detected yet."
                  : "No claims match this filter."}
              </p>
            ) : (
              visible.map((claim) => (
                <ClaimCard
                  key={claim.id}
                  claim={claim}
                  onOpen={() => setOpenClaimId(claim.id)}
                  onRetry={() => engineRef.current?.retry(claim.id)}
                />
              ))
            )}
          </div>
        </section>
      </div>

      <ClaimDetailPanel
        claim={openClaim}
        open={Boolean(openClaim)}
        onOpenChange={(open) => {
          if (!open) setOpenClaimId(null);
        }}
      />
    </main>
  );
}
