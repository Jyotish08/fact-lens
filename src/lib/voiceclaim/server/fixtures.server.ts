import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type FixtureMode = "live" | "record" | "replay";

export function getFixtureMode(): FixtureMode {
  const mode = process.env["VOICECLAIM_FIXTURE_MODE"]?.toLowerCase();
  if (mode === "record" || mode === "replay") return mode;
  return "live";
}

function getFixtureDir(): string {
  const root = process.cwd();
  const dir = path.join(root, "eval", "fixtures");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function fixtureFilePath(kind: "search" | "scrape", key: string): string {
  const hash = crypto.createHash("sha256").update(`${kind}:${key}`).digest("hex");
  return path.join(getFixtureDir(), `${hash}.json`);
}

export async function withFixture<T>(
  kind: "search" | "scrape",
  key: string,
  liveFn: () => Promise<T>,
): Promise<T> {
  const mode = getFixtureMode();
  if (mode === "live") {
    return liveFn();
  }

  const filePath = fixtureFilePath(kind, key);

  if (mode === "replay") {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw);
      return data.payload as T;
    }

    const evalItemId = process.env["VOICECLAIM_EVAL_ITEM_ID"];
    if (evalItemId && kind === "search") {
      const itemFixturePath = path.join(getFixtureDir(), "items", `${evalItemId}.json`);
      if (fs.existsSync(itemFixturePath)) {
        const raw = fs.readFileSync(itemFixturePath, "utf-8");
        const itemData = JSON.parse(raw);
        if (itemData.isDown) {
          throw new Error("BRIGHTDATA_NETWORK_UNREACHABLE");
        }
        return itemData.searchHits as T;
      }
    }

    throw new Error(
      `FIXTURE_MISSING: No fixture found for ${kind} with key "${key}" at ${filePath}`,
    );
  }

  // Record mode
  const payload = await liveFn();
  const entry = {
    kind,
    key,
    recordedAt: new Date().toISOString(),
    payload,
  };
  fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), "utf-8");
  return payload;
}
