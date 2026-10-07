import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  localHistory,
  saveSettings,
} from "@/lib/voiceclaim/history";
import { INTERVAL_SECONDS, MODE_LABELS, type SessionSettings } from "@/lib/voiceclaim/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Verification settings — Fact Lens" },
      {
        name: "description",
        content:
          "Set default mode, verification depth, chunk interval, source count and concurrency for verification sessions.",
      },
      { property: "og:title", content: "Verification settings — Fact Lens" },
      {
        property: "og:description",
        content: "Defaults for mode, depth, chunk interval and research breadth.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 border-b py-7 last:border-b-0 sm:grid-cols-[260px_minmax(0,1fr)]">
      <div>
        <h2 className="font-display text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Choice<T extends string>({
  value,
  options,
  labels,
  onChange,
}: {
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors",
            value === option
              ? "border-live/50 bg-live/10 text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

function SettingsPage() {
  const [settings, setSettings] = useState<SessionSettings>(DEFAULT_SETTINGS);

  useEffect(() => setSettings(loadSettings()), []);

  const patch = (next: Partial<SessionSettings>) => {
    const merged = { ...settings, ...next };
    setSettings(merged);
    saveSettings(merged);
  };

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
      <p className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
        Session defaults
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">Verification settings</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Defaults applied to new sessions. Everything is stored on this device.
      </p>

      <div className="editorial-card mt-8 rounded-2xl px-6 sm:px-8">
        <Row
          title="Default mode"
          hint="Determines which source hierarchy the evidence agent prefers."
        >
          <Choice
            value={settings.mode}
            options={["general", "investor", "academic", "custom"] as const}
            labels={MODE_LABELS}
            onChange={(mode) => patch({ mode })}
          />
        </Row>

        <Row
          title="Verification depth"
          hint="Deep Verify runs additional research rounds and a broader contradiction search."
        >
          <Choice
            value={settings.depth}
            options={["quick", "deep"] as const}
            labels={{ quick: "Quick Verify", deep: "Deep Verify" }}
            onChange={(depth) => patch({ depth })}
          />
        </Row>

        <Row
          title="Chunk interval"
          hint="How often the transcript buffer is swept. Semantic sentence completion can trigger a chunk earlier."
        >
          <Choice
            value={settings.intervalPreset}
            options={["fast", "balanced", "long"] as const}
            labels={{
              fast: `Fast · ${INTERVAL_SECONDS.fast}s`,
              balanced: `Balanced · ${INTERVAL_SECONDS.balanced}s`,
              long: `Long context · ${INTERVAL_SECONDS.long}s`,
            }}
            onChange={(intervalPreset) => patch({ intervalPreset })}
          />
        </Row>

        <Row
          title="Sources per round"
          hint="Target number of strong sources the evidence agent gathers per research round."
        >
          <div className="flex items-center gap-4">
            <Slider
              className="max-w-xs"
              value={[settings.sourceCount]}
              min={2}
              max={8}
              step={1}
              onValueChange={([value]) => patch({ sourceCount: value ?? 3 })}
            />
            <span className="tabular font-display text-sm font-semibold">
              {settings.sourceCount}
            </span>
          </div>
        </Row>

        <Row
          title="Concurrent claims"
          hint="How many claims are researched simultaneously while speech continues."
        >
          <div className="flex items-center gap-4">
            <Slider
              className="max-w-xs"
              value={[settings.concurrency]}
              min={1}
              max={4}
              step={1}
              onValueChange={([value]) => patch({ concurrency: value ?? 2 })}
            />
            <span className="tabular font-display text-sm font-semibold">
              {settings.concurrency}
            </span>
          </div>
        </Row>

        <Row
          title="Local data"
          hint="Sessions, claims and evidence are stored in this browser only."
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void localHistory.clear().then(() => toast.success("Local history cleared"));
            }}
          >
            Delete local history
          </Button>
        </Row>
      </div>
    </main>
  );
}
