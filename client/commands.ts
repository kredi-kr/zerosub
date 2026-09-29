import type { PluginClientContext } from "@getpaseo/plugin/client";
import { FAMILY_LABEL, type AccountView, type StateView } from "../shared/model";
import { setAgentAccount, setDefaultAccount } from "../shared/rpc";
import type { ZeroSubStore } from "./store";

/** Command Center entries and the `/account` slash command. */
export function contributeCommands(client: PluginClientContext, store: ZeroSubStore): () => void {
  const removers: Array<() => void> = [];

  removers.push(
    client.addCommandCenterItem({
      id: "open-accounts",
      title: "구독 계정 관리 (ZeroSub)",
      icon: "Users",
      keywords: ["zerosub", "claude", "chatgpt", "codex", "account", "subscription", "login", "switch", "계정", "구독", "로그인", "전환"],
      context: "global",
      onSelect({ openSurface }) {
        openSurface("accounts");
      },
    }),
  );

  removers.push(
    client.addSlashCommand({
      name: "account",
      description: "이 에이전트가 쓰는 구독 계정을 바꿉니다",
      argumentHint: "[이름 | default]",
      context: "agent",
      async onSubmit({ args, agent, openSurface }) {
        const state = await currentState(store);
        const family = state.providers[agent.provider];
        if (!family) throw new Error(`${agent.provider} 에이전트는 Claude나 ChatGPT 구독 계정을 쓰지 않습니다.`);
        const query = args.trim();
        if (!query) {
          openSurface("accounts");
          return;
        }
        const accounts = state.accounts.filter((account) => account.family === family);
        if (/^default$/i.test(query)) {
          await store.rpc(setAgentAccount, { agentId: agent.id, accountId: null });
          return;
        }
        const match = findAccount(accounts, query);
        if (!match) {
          const names = accounts.map((account) => account.label).join(", ");
          throw new Error(`"${query}"와 맞는 ${FAMILY_LABEL[family]} 계정이 없습니다. 계정 목록: ${names || "없음"}.`);
        }
        if (match.status === "signed_out") throw new Error(`${match.label} 계정은 로그아웃되어 있습니다. 계정 화면에서 먼저 로그인하세요.`);
        if (match.status === "disabled") throw new Error(`${match.label} 계정은 사용 중지되어 있습니다. 계정 화면에서 먼저 다시 사용으로 바꾸세요.`);
        await store.rpc(setAgentAccount, { agentId: agent.id, accountId: match.id });
      },
    }),
  );

  // One "Make … the default" entry per account, kept in step with the account list.
  let dynamic: Array<() => void> = [];
  let signature = "";
  const syncDynamic = () => {
    const state = store.current.state;
    const next = state ? JSON.stringify(state.accounts.map((a) => [a.id, a.label, a.isDefault, a.status])) : "";
    if (next === signature) return;
    signature = next;
    for (const remove of dynamic) remove();
    dynamic = [];
    if (!state) return;
    state.accounts.forEach((account, index) => {
      if (account.isDefault || account.status === "signed_out" || account.status === "disabled") return;
      dynamic.push(
        client.addCommandCenterItem({
          id: `default-${index}`,
          title: `${account.label}을(를) 기본 ${FAMILY_LABEL[account.family]} 계정으로 지정`,
          icon: "Star",
          keywords: ["account", "default", "switch", "계정", "기본", account.email ?? "", account.family],
          context: "global",
          async onSelect() {
            await store.rpc(setDefaultAccount, { accountId: account.id });
          },
        }),
      );
    });
  };
  const unsubscribe = store.subscribe(syncDynamic);
  syncDynamic();

  return () => {
    unsubscribe();
    for (const remove of dynamic) remove();
    for (const remove of removers) remove();
  };
}

async function currentState(store: ZeroSubStore): Promise<StateView> {
  if (!store.current.state) await store.refresh();
  const state = store.current.state;
  if (!state) throw new Error(store.current.error ?? "아직 계정 정보를 불러오지 못했습니다.");
  return state;
}

export function findAccount(accounts: readonly AccountView[], query: string): AccountView | undefined {
  const needle = query.trim().toLowerCase();
  const exact = accounts.find(
    (account) => account.label.toLowerCase() === needle || account.email?.toLowerCase() === needle,
  );
  if (exact) return exact;
  const prefix = accounts.filter(
    (account) => account.label.toLowerCase().startsWith(needle) || account.email?.toLowerCase().startsWith(needle),
  );
  if (prefix.length === 1) return prefix[0];
  const partial = accounts.filter(
    (account) => account.label.toLowerCase().includes(needle) || account.email?.toLowerCase().includes(needle),
  );
  return partial.length === 1 ? partial[0] : undefined;
}
