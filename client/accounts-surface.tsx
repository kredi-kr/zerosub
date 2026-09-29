import { useHosts, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsCard, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { accountSubtitle, formatAge, formatPlan, usageSummary } from "../shared/format";
import { FAMILY_LABEL, type AccountView, type Family } from "../shared/model";
import { preferences } from "../shared/preferences";
import {
  clearAccountLimit,
  removeAccount,
  renameAccount,
  setAccountEnabled,
  setDefaultAccount,
  type ReopenSummary,
} from "../shared/rpc";
import { AddAccountModal } from "./add-account";
import { ResetConfirm, redeemToast, resetBadge } from "./reset-confirm";
import { describe, useStore, VISIBLE_POLL_MS, type ZeroSubStore } from "./store";
import { Badge, Button, Card, IconButton, UsageBar, useText } from "./ui";

type Theme = PluginSurfaceProps["theme"];

export function AccountsSurface(props: PluginSurfaceProps & { store: ZeroSubStore }) {
  const { theme, layout, host, store } = props;
  const { state, error } = useStore(store);
  const text = useText(theme);
  const [adding, setAdding] = useState<{ family: Family; accountId?: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshUsage = useCallback(async () => {
    setRefreshing(true);
    try {
      await store.refresh({ refreshUsage: true });
    } finally {
      setRefreshing(false);
    }
  }, [store]);
  // Each host runs its own copy of the plugin with its own accounts; Paseo's host picker switches.
  const hosts = useHosts();
  const multiHost = hosts.length > 1;
  const hostStatus = hosts.find((entry) => entry.serverId === host.id)?.status;
  const offline = hostStatus !== undefined && hostStatus !== "online";
  // Keep usage moving while the screen is open.
  useEffect(() => store.watch(VISIBLE_POLL_MS), [store]);

  const families: Family[] = ["claude", "codex"];
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <ScrollView
        contentContainerStyle={{
          padding: layout.compact ? 16 : 28,
          gap: layout.compact ? 20 : 28,
          maxWidth: 820,
          width: "100%",
          alignSelf: "center",
        }}
      >
        <View style={{ gap: 6 }}>
          <Text style={[text.small, { fontWeight: "600", letterSpacing: 0.4 }]}>ZeroSub</Text>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <Text style={text.title} accessibilityRole="header">
              구독 계정
            </Text>
            {state ? (
              <IconButton
                theme={theme}
                icon="RefreshCw"
                label="사용량 새로고침"
                tooltip="모든 계정의 사용량을 지금 새로 불러옵니다"
                tooltipPlacement="bottom"
                busy={refreshing}
                onPress={() => void refreshUsage()}
              />
            ) : null}
          </View>
          <Text style={text.muted}>
            여러 Claude·ChatGPT 계정에 로그인해 두세요. 에이전트마다 계정 하나를 쓰고, 그 계정이
            사용 한도에 닿으면 다른 계정으로 옮겨 하던 일을 이어갑니다.
          </Text>
        </View>

        {multiHost ? <HostScope theme={theme} label={host.label} /> : null}

        {error && (offline || !state) ? (
          <Card theme={theme}>
            <Text style={text.danger}>
              {offline
                ? `${host.label}에 연결할 수 없습니다. 계정은 그 컴퓨터에 저장되어 있${
                    state ? "으며, 아래는 마지막으로 확인한 모습입니다." : "고, 다시 연결되면 여기에 나타납니다."
                  }`
                : `Paseo 데몬에 연결할 수 없습니다: ${error}`}
            </Text>
            <Button
              theme={theme}
              label="다시 시도"
              icon="RefreshCw"
              tooltip="이 호스트에 계정 목록을 다시 요청합니다"
              tooltipAlign="start"
              onPress={() => void store.refresh()}
            />
          </Card>
        ) : null}

        {state?.warnings.map((warning) => (
          <Card theme={theme} key={warning}>
            <Text style={text.warning}>{warning}</Text>
          </Card>
        ))}

        {!state && !error ? <Text style={text.muted}>계정을 불러오는 중…</Text> : null}

        {state
          ? families.map((family) => (
              <FamilySection
                key={family}
                family={family}
                accounts={state.accounts.filter((account) => account.family === family)}
                theme={theme}
                compact={layout.compact}
                store={store}
                onAdd={() => setAdding({ family })}
                onSignIn={(account) => setAdding({ family, accountId: account.id })}
              />
            ))
          : null}

        <AutomationSettings theme={theme} />
      </ScrollView>

      {adding ? (
        <AddAccountModal
          theme={theme}
          layout={layout}
          host={host}
          multiHost={multiHost}
          store={store}
          family={adding.family}
          accountId={adding.accountId}
          onClose={() => setAdding(null)}
        />
      ) : null}
    </View>
  );
}

/** Says whose accounts these are when the app knows several hosts. */
function HostScope({ theme, label }: { theme: Theme; label: string }) {
  const text = useText(theme);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <Icon name="Server" size={16} color={theme.colors.foregroundMuted} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={text.strong}>{label}의 계정</Text>
        <Text style={text.small}>
          이 호스트의 에이전트만 이 계정들을 씁니다. 호스트마다 계정과 설정을 따로 보관하므로, 쓰는 호스트마다
          로그인하세요. 호스트는 맨 위의 호스트 선택기에서 바꿀 수 있고, ZeroSub가 설치된 호스트만 그곳에
          나타납니다.
        </Text>
      </View>
    </View>
  );
}

function FamilySection({
  family,
  accounts,
  theme,
  compact,
  store,
  onAdd,
  onSignIn,
}: {
  family: Family;
  accounts: AccountView[];
  theme: Theme;
  compact: boolean;
  store: ZeroSubStore;
  onAdd(): void;
  onSignIn(account: AccountView): void;
}) {
  const text = useText(theme);
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={text.heading} accessibilityRole="header">
          {family === "claude" ? "Claude" : "ChatGPT (Codex)"}
        </Text>
        <Button
          theme={theme}
          icon="Plus"
          label={compact ? "추가" : "계정 추가"}
          accessibilityLabel={`${FAMILY_LABEL[family]} 계정 추가`}
          tooltip={`${FAMILY_LABEL[family]} 계정을 하나 더 로그인합니다`}
          tooltipAlign="end"
          onPress={onAdd}
        />
      </View>
      {accounts.length === 0 ? (
        <Text style={text.muted}>아직 {FAMILY_LABEL[family]} 계정이 없습니다.</Text>
      ) : null}
      {chunk(accounts, compact ? 1 : 2).map((row) => (
        <View key={row.map((account) => account.id).join()} style={{ flexDirection: "row", gap: 10 }}>
          {row.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              theme={theme}
              store={store}
              onSignIn={() => onSignIn(account)}
            />
          ))}
          {!compact && row.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

function AccountCard({
  account,
  theme,
  store,
  onSignIn,
}: {
  account: AccountView;
  theme: Theme;
  store: ZeroSubStore;
  onSignIn(): void;
}) {
  const text = useText(theme);
  const toast = useToast();
  const [busy, setBusy] = useState<"default" | "remove" | "clear" | "toggle" | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const resets = account.usage?.resets ?? null;
  const plan = formatPlan(account.plan);
  const summary = usageSummary(account);
  const subtitle = accountSubtitle(account);
  const signedOut = account.status === "signed_out";
  const disabled = account.status === "disabled";
  const faded = disabled ? { opacity: 0.55 } : null;
  const windows = account.usage?.windows ?? [];
  const agents = account.agentCount === 0 ? "에이전트 없음" : `에이전트 ${account.agentCount}개`;
  const freshness = !signedOut && account.usage && windows.length > 0 ? `${formatAge(account.usage.fetchedAt)} 갱신` : null;

  // Sets the account aside for a while, or brings it back; its agents move off it and back.
  const toggle = useCallback(async () => {
    const enabling = account.status === "disabled";
    setBusy("toggle");
    try {
      const result = await store.rpc(setAccountEnabled, { accountId: account.id, enabled: enabling });
      const message = describeReopen(`${account.label}: ${enabling ? "다시 사용합니다" : "사용을 멈췄습니다"}`, result);
      const stayed =
        result.stayed > 0
          ? ` · ChatGPT 대화 ${result.stayed}개는 이 계정에 남습니다 (대화 도중 계정을 바꿀 수 없음)`
          : "";
      toast.show(`${message}${stayed}`, { variant: "success", durationMs: 5_000 });
    } catch (error) {
      toast.error(describe(error));
    } finally {
      setBusy(null);
    }
  }, [account, store, toast]);

  const makeDefault = useCallback(async () => {
    setBusy("default");
    try {
      const summary = await store.rpc(setDefaultAccount, { accountId: account.id });
      toast.show(describeReopen(`${account.label}: 이제 기본 계정입니다`, summary), { variant: "success" });
      await store.refresh();
    } catch (error) {
      toast.error(describe(error));
    } finally {
      setBusy(null);
    }
  }, [account, store, toast]);

  // For when the user knows better, e.g. after upgrading the plan or buying credits.
  const markAvailable = useCallback(async () => {
    setBusy("clear");
    try {
      await store.rpc(clearAccountLimit, { accountId: account.id });
      toast.show(`${account.label}: 다시 사용할 수 있습니다`, { variant: "success" });
    } catch (error) {
      toast.error(describe(error));
    } finally {
      setBusy(null);
    }
  }, [account, store, toast]);

  const remove = useCallback(async () => {
    setBusy("remove");
    try {
      const result = await store.rpc(removeAccount, { accountId: account.id });
      toast.show(
        result.movedAgents > 0
          ? `${account.label} 계정을 삭제했습니다. 에이전트 ${result.movedAgents}개는 기본 계정으로 옮겼습니다`
          : `${account.label} 계정을 삭제했습니다`,
        { variant: "success" },
      );
      await store.refresh();
    } catch (error) {
      toast.error(describe(error));
    } finally {
      setBusy(null);
      setConfirmRemove(false);
    }
  }, [account, store, toast]);

  return (
    <Card theme={theme} fill>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View style={faded}>
          <Avatar theme={theme} label={account.label} />
        </View>
        <View style={[{ flex: 1, minWidth: 0, gap: 3 }, faded]}>
          <Text style={text.strong} numberOfLines={1}>
            {account.label}
          </Text>
          {subtitle ? (
            <Text style={text.small} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginTop: -4, marginRight: -6 }}>
          {account.status === "limited" ? (
            <IconButton
              theme={theme}
              icon="CircleCheck"
              label="다시 사용 가능으로 표시 (여유 있음)"
              tooltip="사용 가능으로 표시: 요금제를 올린 뒤처럼, 한도가 초기화되기 전에 다시 씁니다"
              busy={busy === "clear"}
              onPress={() => void markAvailable()}
            />
          ) : null}
          {!account.isDefault && !signedOut && !disabled ? (
            <IconButton
              theme={theme}
              icon="Star"
              label="기본 계정으로 지정"
              tooltip="기본 계정으로 지정: 새 에이전트가 이 계정으로 시작합니다"
              busy={busy === "default"}
              onPress={() => void makeDefault()}
            />
          ) : null}
          <IconButton
            theme={theme}
            icon={disabled ? "CirclePlay" : "CirclePause"}
            label={disabled ? "계정 다시 사용" : "잠시 사용 중지 (에이전트가 쓰지 않음)"}
            tooltip={
              disabled
                ? "다시 사용: 에이전트가 이 계정을 다시 쓸 수 있습니다"
                : "잠시 사용 중지: 에이전트가 이 계정을 그만 쓰고 다른 계정으로 옮깁니다"
            }
            busy={busy === "toggle"}
            onPress={() => void toggle()}
          />
          <IconButton theme={theme} icon="Pencil" label="이름 바꾸기" tooltip="이 계정의 이름을 바꿉니다" onPress={() => setRenaming(true)} />
          {account.kind !== "main" ? (
            <IconButton
              theme={theme}
              icon="Trash2"
              label="삭제"
              tooltip="삭제: 로그아웃하고 저장된 로그인 정보를 지웁니다"
              tone="danger"
              busy={busy === "remove"}
              onPress={() => setConfirmRemove(true)}
            />
          ) : null}
        </View>
      </View>

      <View style={[{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }, faded]}>
        {account.isDefault ? <Badge theme={theme} label="기본" tone="accent" /> : null}
        {disabled ? <Badge theme={theme} label="사용 중지됨" /> : null}
        {plan ? <Badge theme={theme} label={plan} /> : null}
        {account.kind === "main" ? <Badge theme={theme} label="CLI 로그인" /> : null}
        {account.status === "limited" ? <Badge theme={theme} label="한도 도달" tone="danger" /> : null}
        {account.status === "signed_out" ? <Badge theme={theme} label="로그아웃됨" tone="warning" /> : null}
        {resets && !signedOut ? <Badge theme={theme} label={resetBadge(resets)} tone="accent" /> : null}
      </View>

      <View style={[{ gap: 10 }, faded]}>
        {signedOut ? (
          <Text style={text.small}>이 계정을 쓰려면 다시 로그인하세요.</Text>
        ) : windows.length > 0 ? (
          windows.map((limit) => <UsageBar key={limit.id} theme={theme} limit={limit} />)
        ) : (
          <Text style={text.small}>{account.usage?.error ?? summary ?? "사용량 확인 중…"}</Text>
        )}
        {!signedOut && windows.length > 0 && account.usage?.error ? <Text style={text.small}>{account.usage.error}</Text> : null}
        {!signedOut && resets?.blockedReason ? <Text style={text.small}>{resets.blockedReason}</Text> : null}
      </View>

      {/* Pinned to the bottom, so cards side by side line up however much each one shows. */}
      <View
        style={{
          marginTop: "auto",
          minHeight: 38,
          paddingTop: 10,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          columnGap: 8,
          rowGap: 8,
        }}
      >
        <Text style={[text.small, { flexShrink: 1 }]} numberOfLines={1}>
          {disabled ? "사용 중지됨 · 에이전트가 쓰지 않음" : freshness ? `${agents} · ${freshness}` : agents}
        </Text>
        {signedOut ? (
          <Button
            theme={theme}
            size="small"
            tone="primary"
            icon="LogIn"
            label="로그인"
            tooltip="이 계정에 다시 로그인합니다"
            tooltipAlign="end"
            onPress={onSignIn}
          />
        ) : disabled ? (
          <Button
            theme={theme}
            size="small"
            tone="primary"
            icon="CirclePlay"
            label="다시 사용"
            tooltip="이 계정을 다시 씁니다. 원래 쓰던 에이전트가 돌아옵니다"
            tooltipAlign="end"
            busy={busy === "toggle"}
            onPress={() => void toggle()}
          />
        ) : resets ? (
          <Button
            theme={theme}
            size="small"
            tone={account.status === "limited" ? "primary" : "secondary"}
            icon="TimerReset"
            label="초기화권 사용"
            accessibilityLabel="한도 초기화권 사용"
            tooltip="한도 초기화권 하나를 써서 이 계정의 한도를 지금 채웁니다"
            tooltipAlign="end"
            disabled={!resets.usableNow}
            onPress={() => setConfirmReset(true)}
          />
        ) : null}
      </View>
      <Modal title="한도 초기화권을 쓸까요?" open={confirmReset} onOpenChange={setConfirmReset}>
        <Modal.Content>
          <ResetConfirm
            theme={theme}
            store={store}
            account={account}
            onCancel={() => setConfirmReset(false)}
            onFinished={(result) => {
              setConfirmReset(false);
              const { message, variant } = redeemToast(account.label, result);
              if (variant === "error") toast.error(message);
              else toast.show(message, { variant, durationMs: 5_000 });
            }}
          />
        </Modal.Content>
      </Modal>

      {renaming ? (
        <RenameModal theme={theme} account={account} store={store} onClose={() => setRenaming(false)} />
      ) : null}
      <Modal title={`${account.label} 계정을 삭제할까요?`} open={confirmRemove} onOpenChange={setConfirmRemove}>
        <Modal.Content>
          <Text style={text.body}>
            {account.family === "claude"
              ? "이 컴퓨터에서 계정을 로그아웃하고 저장된 로그인 정보를 지웁니다. 이 계정을 쓰던 에이전트는 기본 계정으로 옮기며, 대화는 그대로 남습니다."
              : "이 컴퓨터에서 계정을 로그아웃하고 저장된 로그인 정보를 지웁니다. 새 에이전트는 기본 계정을 씁니다. 이 계정의 기존 ChatGPT 대화는 옮길 수 없으니, 필요하면 새 에이전트를 시작하세요."}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
            <Button theme={theme} label="취소" tooltip="이 계정을 그대로 둡니다" tooltipAlign="end" onPress={() => setConfirmRemove(false)} />
            <Button
              theme={theme}
              tone="danger"
              icon="Trash2"
              label="삭제"
              tooltip="로그아웃하고 저장된 로그인 정보를 지웁니다. 쓰던 에이전트는 기본 계정으로 옮깁니다"
              tooltipAlign="end"
              busy={busy === "remove"}
              onPress={() => void remove()}
            />
          </View>
        </Modal.Content>
      </Modal>
    </Card>
  );
}

function RenameModal({
  theme,
  account,
  store,
  onClose,
}: {
  theme: Theme;
  account: AccountView;
  store: ZeroSubStore;
  onClose(): void;
}) {
  const text = useText(theme);
  const toast = useToast();
  const [label, setLabel] = useState(account.label);
  const [saving, setSaving] = useState(false);
  const save = useCallback(async () => {
    const next = label.trim();
    if (!next) return;
    setSaving(true);
    try {
      await store.rpc(renameAccount, { accountId: account.id, label: next });
      await store.refresh();
      onClose();
    } catch (error) {
      toast.error(describe(error));
    } finally {
      setSaving(false);
    }
  }, [label, account.id, store, onClose, toast]);
  const inputStyle = useMemo(
    () => ({
      color: theme.colors.foreground,
      backgroundColor: theme.colors.surface2,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    }),
    [theme],
  );
  return (
    <Modal title="계정 이름 바꾸기" open onOpenChange={(open) => (open ? undefined : onClose())}>
      <Modal.Content>
        <Text style={text.muted}>메시지 입력창에서 알아보기 쉬운 짧은 이름. 예: "회사", "개인".</Text>
        <TextInput
          value={label}
          onChangeText={setLabel}
          autoFocus
          maxLength={40}
          placeholder="계정 이름"
          placeholderTextColor={theme.colors.foregroundMuted}
          onSubmitEditing={() => void save()}
          style={inputStyle}
          accessibilityLabel="계정 이름"
        />
        <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
          <Button theme={theme} label="취소" tooltip="지금 이름을 그대로 둡니다" tooltipAlign="end" onPress={onClose} />
          <Button
            theme={theme}
            tone="primary"
            label="저장"
            tooltip="새 이름을 저장합니다"
            tooltipAlign="end"
            busy={saving}
            disabled={!label.trim()}
            onPress={() => void save()}
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}

function Avatar({ theme, label }: { theme: Theme; label: string }) {
  const initial = label.trim().charAt(0).toUpperCase() || "?";
  return (
    <View
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.colors.surface2,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <Text style={{ color: theme.colors.foreground, fontSize: 15, fontWeight: "700" }}>{initial}</Text>
    </View>
  );
}

function AutomationSettings({ theme }: { theme: Theme }) {
  const settings = useSettings(preferences);
  const text = useText(theme);
  if (settings.status === "loading") return null;
  if (settings.status !== "ready") {
    return <Text style={text.danger}>설정을 불러올 수 없습니다: {settings.error}</Text>;
  }
  const save = (patch: Partial<typeof settings.values>) =>
    void settings.save({ ...settings.values, ...patch }, settings.revision);
  return (
    <View style={{ gap: 10 }}>
      <Text style={text.heading} accessibilityRole="header">
        자동 전환
      </Text>
      <SettingsCard>
        <SettingsSwitch
          label="한도에 닿으면 계정 자동 전환"
          hint="에이전트가 여유가 가장 많은 계정으로 옮깁니다."
          value={settings.values.autoSwitch}
          disabled={settings.saving}
          onValueChange={(autoSwitch) => save({ autoSwitch })}
        />
        <SettingsSwitch
          label="전환 후 하던 일 이어가기"
          hint="짧은 이어가기 메시지를 보내 멈춘 작업을 계속하게 합니다."
          value={settings.values.autoContinue}
          disabled={settings.saving || !settings.values.autoSwitch}
          onValueChange={(autoContinue) => save({ autoContinue })}
        />
        <SettingsSwitch
          label="새 에이전트를 여러 계정에 나누기"
          hint="새 에이전트가 기본 계정 대신 여유가 가장 많은 계정으로 시작합니다."
          value={settings.values.balanceNewAgents}
          disabled={settings.saving}
          onValueChange={(balanceNewAgents) => save({ balanceNewAgents })}
        />
        <SettingsSwitch
          label="모든 계정이 한도에 닿으면 한도 초기화권 사용"
          hint="멈추는 대신 계정의 한도 초기화권을 하나 씁니다. 초기화권은 귀하므로 직접 켜야만 작동합니다."
          value={settings.values.autoRedeem}
          disabled={settings.saving || !settings.values.autoSwitch}
          onValueChange={(autoRedeem) => save({ autoRedeem })}
        />
        <SettingsSwitch
          label="모든 계정이 한도에 닿으면 다른 서비스로 대화 이어가기"
          hint="멈춘 Claude 대화를 지금까지의 내용과 함께 새 ChatGPT 에이전트에서 이어갑니다(반대 방향도 마찬가지). 새 에이전트는 원래 에이전트보다 더 많은 권한을 받지 않으며, 원래 대화는 그대로 남습니다."
          value={settings.values.forkOtherProvider}
          disabled={settings.saving || !settings.values.autoSwitch}
          onValueChange={(forkOtherProvider) => save({ forkOtherProvider })}
        />
      </SettingsCard>
      {settings.saveError ? <Text style={text.danger}>{settings.saveError}</Text> : null}
    </View>
  );
}

export function describeReopen(prefix: string, summary: ReopenSummary): string {
  const parts = [prefix];
  if (summary.continuedIn) parts.push(`“${summary.continuedIn.title}”에서 이어감`);
  if (summary.reopened.length > 0) parts.push(`에이전트 ${summary.reopened.length}개 전환됨`);
  if (summary.deferred.length > 0) parts.push(`${summary.deferred.length}개는 지금 작업을 마친 뒤 전환`);
  if (summary.failed.length > 0) parts.push(`${summary.failed.length}개는 다음에 다시 시작할 때 전환`);
  return parts.join(" · ");
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

