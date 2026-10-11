import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTINUED_AT_LABEL, CONTINUED_FROM_LABEL, continueInNewAgent } from "./handoff";

interface CreateRequest {
  agentId: string;
  config: { provider: string; modeId?: string; thinkingOptionId?: string };
  title: string;
  prompt: string;
  labels: Record<string, string>;
}

interface SourceAgent {
  provider: string;
  title: string;
  model: string;
  currentModeId: string;
  thinkingOptionId?: string;
  workspaceId?: string;
  cwd?: string;
  labels: Record<string, string>;
}

function sourceAgent(patch: Partial<SourceAgent> = {}): SourceAgent {
  return {
    provider: "codex",
    title: "Build release",
    model: "gpt-5.6-sol",
    currentModeId: "auto",
    workspaceId: "workspace-1",
    labels: {},
    ...patch,
  };
}

function fakePaseo(source: SourceAgent, beforeCreate?: () => void) {
  const created: CreateRequest[] = [];
  const create = async (request: CreateRequest) => {
    beforeCreate?.();
    created.push(request);
  };
  const paseo = {
    agents: {
      ref: () => ({ refresh: async () => ({ agent: source }) }),
      create,
    },
    providers: {
      listModels: async (provider: string) => ({
        models: [{ id: provider === "codex" ? "gpt-5.6-sol" : "claude-sonnet", isDefault: true }],
      }),
    },
    workspaces: {
      ref: () => ({ agents: { create } }),
    },
  } as never;
  return { paseo, created };
}

async function continueAgent(
  source: SourceAgent,
  target?: { provider: string; label: string; modeId: string },
  beforeCreate?: () => void,
) {
  const { paseo, created } = fakePaseo(source, beforeCreate);
  await continueInNewAgent({
    paseo,
    sourceAgentId: "source-agent",
    timeline: [],
    why: "the account reached its usage limit",
    bind: async () => undefined,
    ...(target ? { target } : {}),
  });
  return created[0];
}

afterEach(() => vi.useRealTimers());

describe("continuation titles and creation labels", () => {
  it("uses one UTC instant for a KST title across the UTC date boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T15:00:00.123Z"));

    const request = await continueAgent(
      sourceAgent({ provider: "claude", model: "claude-opus", currentModeId: "acceptEdits" }),
      { provider: "codex", label: "ChatGPT", modeId: "full-access" },
      () => vi.setSystemTime(new Date("2026-10-11T15:00:01.999Z")),
    );

    expect(request?.title).toBe("Build release (ChatGPT에서 이어서 2026-10-12 00:00:00 KST)");
    expect(request?.labels).toEqual({
      [CONTINUED_FROM_LABEL]: "source-agent",
      [CONTINUED_AT_LABEL]: "2026-10-11T15:00:00.123Z",
    });
    expect(request?.config).toEqual({ provider: "codex/gpt-5.6-sol", modeId: "full-access" });
  });

  it.each([
    "Build release (이어서)",
    "Build release (ChatGPT에서 이어서)",
    "Build release (ChatGPT에서 이어서 2026-10-10 09:08:07 KST)",
  ])("replaces a prior generated suffix in %s", async (title) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T14:59:59.500Z"));

    const request = await continueAgent(
      sourceAgent({
        title,
        labels: { [CONTINUED_FROM_LABEL]: "earlier-agent" },
      }),
      { provider: "claude", label: "Claude", modeId: "acceptEdits" },
    );

    expect(request?.title).toBe("Build release (Claude에서 이어서 2026-10-11 23:59:59 KST)");
    expect(request?.labels[CONTINUED_AT_LABEL]).toBe("2026-10-11T14:59:59.500Z");
  });

  it("preserves a user title that only resembles an automatic suffix", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T14:59:59.500Z"));

    const request = await continueAgent(sourceAgent({ title: "Research notes (ChatGPT에서 이어서)" }));

    expect(request?.title).toBe("Research notes (ChatGPT에서 이어서) (이어서 2026-10-11 23:59:59 KST)");
    expect(request?.labels[CONTINUED_FROM_LABEL]).toBe("source-agent");
    expect(request?.config).toEqual({ provider: "codex/gpt-5.6-sol", modeId: "auto" });
  });
});
