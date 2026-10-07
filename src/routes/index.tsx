import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle, FileUp, Info, LoaderCircle, Mic, ShieldCheck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  stashLaunch,
} from "@/lib/voiceclaim/history";
import { getScenarioForMode } from "@/lib/voiceclaim/data/scenarios";
import { createAnonymousSession, getIntegrationHealth } from "@/lib/voiceclaim/functions";
import { assetRepository } from "@/lib/voiceclaim/storage";
import {
  INTERVAL_SECONDS,
  MODE_LABELS,
  type IntervalPreset,
  type SessionSettings,
  type VerificationDepth,
  type VerificationMode,
} from "@/lib/voiceclaim/types";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fact Lens — Verify spoken claims as they are made" },
      {
        name: "description",
        content:
          "Listen to a pitch or lecture while claims are detected, decomposed and checked against live evidence with supporting and contradictory sources.",
      },
      {
        property: "og:title",
        content: "Fact Lens — Verify spoken claims as they are made",
      },
      {
        property: "og:description",
        content:
          "Real-time claim detection, adversarial evidence research and evidence-backed verdicts during live conversation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const MODES: VerificationMode[] = ["general", "investor", "academic", "custom"];
const MODE_BLURB: Record<VerificationMode, string> = {
  general: "Authoritative sources first, then science, organisations and news.",
  investor: "Filings and audited disclosures outrank company marketing.",
  academic: "Peer-reviewed literature and datasets outrank secondary reporting.",
  custom: "Your uploaded corpus plus live web evidence, weighed equally.",
};

const INTERVALS: IntervalPreset[] = ["fast", "balanced", "long"];

function Segmented<T extends string>({
  value,
  options,
  onChange,
  labels,
}: {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <div className="grid w-full auto-cols-fr grid-flow-col rounded-lg border bg-background/70 p-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "cursor-pointer rounded-md px-3 py-2 text-xs font-semibold transition-all",
            value === option
              ? "bg-card text-foreground shadow-sm ring-1 ring-border"
              : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
          )}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

function Landing() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<SessionSettings>(
    typeof window === "undefined" ? DEFAULT_SETTINGS : loadSettings(),
  );
  const [corpus, setCorpus] = useState<File[]>([]);
  const [launching, setLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getIntegrationHealth>> | null>(null);
  const [forceMock, setForceMock] = useState(false);

  useEffect(() => {
    void getIntegrationHealth().then(setHealth).catch(() => undefined);
  }, []);

  const patch = (next: Partial<SessionSettings>) => {
    const merged = { ...settings, ...next };
    setSettings(merged);
    saveSettings(merged);
  };

  const launch = async (
    source: "microphone" | "audio_upload" | "video_upload",
    label: string,
    mediaFile?: File,
  ) => {
    if (launching) return;

    const isLiveMode = !forceMock && health?.mode === "live";
    if (isLiveMode && health && !health.ready) {
      toast.error(
        `Cannot start live session: missing ${health.missing?.join(", ")}. Switch to Mock Mode or check your .env file.`,
      );
      return;
    }

    setLaunching(true);
    setLaunchStatus(
      source === "microphone" ? "Creating secure live session…" : "Preparing selected recording…",
    );
    const sessionId = `s-${Date.now().toString(36)}`;
    try {
      const anonymous = await createAnonymousSession({
        data: {
          requestedSessionId: sessionId,
          requestedServiceMode: forceMock ? "mock" : undefined,
        },
      });
      const scenario = getScenarioForMode(settings.mode);
      if (corpus.length) setLaunchStatus("Saving evidence documents to this browser…");
      const storedCorpus = corpus.length
        ? await assetRepository.storeCorpus(sessionId, corpus)
        : [];
      if (mediaFile) setLaunchStatus("Saving the recording securely for transcription…");
      const mediaAssetId = mediaFile
        ? await assetRepository.storeMedia(sessionId, mediaFile)
        : undefined;
      stashLaunch({
        sessionId,
        title: label,
        source,
        scenarioId: scenario.id,
        settings,
        speed: source === "microphone" ? 1 : 1.8,
        serviceMode: anonymous.serviceMode,
        sessionToken: anonymous.sessionToken,
        mediaAssetId,
        customAssetIds: storedCorpus.map((asset) => asset.id),
      });
      setLaunchStatus("Opening the transcription workspace…");
      await navigate({ to: "/session/$sessionId", params: { sessionId } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start a session");
      await assetRepository.deleteSession(sessionId).catch(() => undefined);
    } finally {
      setLaunching(false);
      setLaunchStatus(null);
    }
  };

  const onUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const isVideo = file.type.includes("mp4") || file.name.endsWith(".mp4");
    void launch(isVideo ? "video_upload" : "audio_upload", file.name, file);
  };

  const onCorpus = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    if (files.length > 5 || files.reduce((sum, file) => sum + file.size, 0) > 25 * 1024 * 1024) {
      toast.error("Use at most five evidence files totaling 25 MB.");
      return;
    }
    setCorpus(files);
    patch({ mode: "custom" });
    toast.success(`${files.length} resource${files.length === 1 ? "" : "s"} added to this session`);
  };

  return (
    <main className="relative flex-1 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 grid-noise opacity-25 [mask-image:linear-gradient(to_bottom,black,transparent_52%)]" />
      <div className="relative mx-auto w-full max-w-[1400px] px-5 py-14 sm:px-8 sm:py-20">
        <p className="text-[11px] font-semibold tracking-[0.24em] text-muted-foreground uppercase">
          Real-time spoken claim verification
        </p>
        <h1 className="mt-5 max-w-4xl text-4xl leading-[1.04] font-semibold tracking-[-0.045em] sm:text-5xl">
          Keep listening. The evidence check runs in parallel.
        </h1>
        <p className="mt-6 max-w-3xl text-[15px] leading-7 text-muted-foreground sm:text-base">
          Fact Lens transcribes speech as it happens, separates objectively verifiable
          assertions from opinion and prediction, breaks compound statements into atomic claims, and
          researches each one against live sources — including evidence that contradicts them.
        </p>

        <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-[1.25fr_0.9fr]">
          <section className="editorial-card flex min-h-[560px] flex-col rounded-2xl p-7 sm:p-10">
            {/* Preflight Integration Status Banner */}
            {health && (
              <div className="mb-6 w-full rounded-xl border border-border/60 bg-card/60 p-4 text-left transition-all">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-3">
                  <div className="flex items-center gap-2">
                    {forceMock || health.mode === "mock" ? (
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                        <CheckCircle className="size-3.5" /> Mock Mode (Deterministic Demo)
                      </span>
                    ) : health.ready ? (
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                        <ShieldCheck className="size-3.5" /> All Providers Configured (Live Mode)
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                        <AlertTriangle className="size-3.5" /> Provider Configuration Needed
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setForceMock(!forceMock)}
                    className="cursor-pointer text-xs font-medium text-muted-foreground underline hover:text-foreground"
                  >
                    {forceMock ? "Switch back to Live Mode" : "Switch to Mock Mode (No Keys)"}
                  </button>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", health.integrations.openAi.configured ? "bg-emerald-500" : "bg-amber-500")} />
                    <span className="text-muted-foreground">OpenAI ({health.models.extraction})</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", health.integrations.speechmatics.configured ? "bg-emerald-500" : "bg-amber-500")} />
                    <span className="text-muted-foreground">Speechmatics ASR</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", health.integrations.brightData.configured ? "bg-emerald-500" : "bg-amber-500")} />
                    <span className="text-muted-foreground">Bright Data MCP</span>
                  </div>
                </div>

                {health.models.modelFallbackActive && (
                  <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-sky-400">
                    <Info className="size-3 shrink-0" />
                    <span>Incompatible model string in .env automatically mapped to standard OpenAI GA ({health.models.extraction}).</span>
                  </div>
                )}

                {!health.ready && !forceMock && (
                  <div className="mt-3 rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-300">
                    <p className="font-medium">Missing credentials: {health.missing?.join(", ")}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Add keys to your <code className="rounded bg-black/40 px-1 py-0.5 font-mono">.env</code> file or click "Switch to Mock Mode" above to verify pre-recorded sessions immediately.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <button
                type="button"
                onClick={() => void launch("microphone", "Live session")}
                disabled={launching}
                className="relative grid size-36 shrink-0 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/10 transition-all hover:-translate-y-1 hover:shadow-2xl disabled:cursor-wait disabled:opacity-60 sm:size-40"
                aria-label="Start live verification"
              >
                <span className="pulse-ring absolute inset-0 rounded-full bg-live/25" />
                <Mic className="relative size-12" strokeWidth={1.8} />
              </button>
              <h2 className="mt-8 font-display text-xl font-semibold">Start live session</h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                Streaming transcription with concurrent claim verification in{" "}
                {MODE_LABELS[settings.mode]} mode.
              </p>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center justify-center gap-3 rounded-lg border bg-background/50 px-4 py-3 transition-colors hover:border-foreground/30 hover:bg-elevated">
                <Upload className="size-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Upload audio or MP4</span>
                <input
                  type="file"
                  accept="audio/*,video/mp4"
                  className="hidden"
                  onChange={onUpload}
                />
              </label>
              <label className="flex cursor-pointer items-center justify-center gap-3 rounded-lg border bg-background/50 px-4 py-3 transition-colors hover:border-foreground/30 hover:bg-elevated">
                <FileUp className="size-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Add evidence documents</span>
                <input
                  type="file"
                  multiple
                  accept=".pdf,.txt,.csv"
                  className="hidden"
                  onChange={onCorpus}
                />
              </label>
            </div>

            <p className="mt-4 text-center text-xs text-muted-foreground">
              Longer recordings take more time to transcribe and verify. MP4 files are analysed by
              audio track only.
            </p>

            {launchStatus && (
              <div className="mt-5 rounded-xl border bg-elevated/60 p-3" aria-live="polite">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  {launchStatus}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/10">
                  <div className="h-full w-2/5 animate-pulse rounded-full bg-primary" />
                </div>
              </div>
            )}

            {corpus.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-2">
                {corpus.map((file) => (
                  <li
                    key={`${file.name}-${file.size}`}
                    className="rounded-full border bg-surface px-3 py-1 text-xs text-muted-foreground"
                  >
                    {file.name}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="editorial-card space-y-7 rounded-2xl bg-elevated/55 p-6 sm:p-8">
            <div className="space-y-3">
              <h2 className="font-display text-base font-semibold">Verification mode</h2>
              <div className="grid gap-2">
                {MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => patch({ mode })}
                    className={cn(
                      "cursor-pointer rounded-xl border bg-card/35 p-3.5 text-left transition-all",
                      settings.mode === mode
                        ? "border-foreground/45 bg-card shadow-sm"
                        : "hover:border-foreground/20 hover:bg-card/70",
                    )}
                  >
                    <span className="font-display text-sm font-semibold">{MODE_LABELS[mode]}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      {MODE_BLURB[mode]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-display text-sm font-semibold">Verification depth</h3>
              <Segmented<VerificationDepth>
                value={settings.depth}
                options={["quick", "deep"]}
                onChange={(depth) => patch({ depth })}
                labels={{ quick: "Quick Verify", deep: "Deep Verify" }}
              />
            </div>

            <div className="space-y-3">
              <h3 className="font-display text-sm font-semibold">Verification interval</h3>
              <Segmented<IntervalPreset>
                value={settings.intervalPreset}
                options={INTERVALS}
                onChange={(intervalPreset) => patch({ intervalPreset })}
                labels={{
                  fast: `Fast · ${INTERVAL_SECONDS.fast}s`,
                  balanced: `Balanced · ${INTERVAL_SECONDS.balanced}s`,
                  long: `Long · ${INTERVAL_SECONDS.long}s`,
                }}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold">Sources per round</h3>
                <span className="tabular font-display text-sm font-semibold">
                  {settings.sourceCount}
                </span>
              </div>
              <Slider
                value={[settings.sourceCount]}
                min={2}
                max={8}
                step={1}
                onValueChange={([value]) => patch({ sourceCount: value ?? 3 })}
              />
            </div>

            <div className="space-y-2">
              <h3 className="font-display text-sm font-semibold">Recording date (optional)</h3>
              <p className="text-xs text-muted-foreground">
                Authoritative date anchor for resolving relative statements ("last year", "last quarter") in recorded media.
              </p>
              <input
                type="date"
                value={settings.recordingDate || ""}
                onChange={(e) => patch({ recordingDate: e.target.value || undefined })}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            <Button
              className="h-11 w-full"
              disabled={launching}
              onClick={() => void launch("microphone", "Live session")}
            >
              {launching ? "Starting…" : "Start live session"}
            </Button>
          </section>
        </div>
      </div>
    </main>
  );
}
