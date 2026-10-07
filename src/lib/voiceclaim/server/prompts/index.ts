export * from "./untrusted";
export * from "./query";
export * from "./evidence";
export * from "./synthesis";
export * from "./extract";
export * from "./verify";
export * from "./context";

export const PROMPT_REGISTRY_VERSIONS = {
  extract: "extract.v3",
  query: "query.v1",
  evidence: "evidence.v1",
  synthesis: "synthesis.v1",
  verify: "verify.v1",
  context: "context.v1",
} as const;
