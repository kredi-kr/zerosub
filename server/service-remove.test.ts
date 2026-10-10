import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FamilyAdapter } from "./adapter";
import { Service } from "./service";
import { StateStore } from "./state";

let dir: string;
let store: StateStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zerosub-remove-"));
  store = new StateStore(join(dir, "state.json"));
  await store.update((draft) => {
    draft.accounts.push({
      id: "claude-main",
      family: "claude",
      label: "main",
      kind: "main",
      home: null,
      autoLabel: false,
      email: null,
      plan: null,
      organization: null,
      identity: null,
      signedIn: false,
      disabled: false,
      limitedUntil: null,
      limitKind: null,
      limitedAt: null,
      createdAt: "2026-09-01T00:00:00Z",
    });
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function serviceWithIdentity(identity: FamilyAdapter["identity"]): Service {
  const adapter = { identity, portable: true } as FamilyAdapter;
  return new Service({ claude: adapter, codex: adapter }, store);
}

describe("removing the CLI account", () => {
  it("keeps the account when login status cannot be checked", async () => {
    const service = serviceWithIdentity(async () => { throw new Error("status unavailable"); });
    await expect(service.remove({} as Parameters<Service["remove"]>[0], "claude-main")).rejects.toThrow("status unavailable");
    expect((await store.read()).accounts.map((account) => account.id)).toEqual(["claude-main"]);
  });

  it("keeps the account while the CLI is signed in", async () => {
    const service = serviceWithIdentity(async () => ({ signedIn: true } as Awaited<ReturnType<FamilyAdapter["identity"]>>));
    await expect(service.remove({} as Parameters<Service["remove"]>[0], "claude-main")).rejects.toThrow();
    expect((await store.read()).accounts.map((account) => account.id)).toEqual(["claude-main"]);
  });
});
