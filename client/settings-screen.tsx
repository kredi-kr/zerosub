import { useHosts, useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import { DEFAULT_CONTINUE_PROMPT, preferences, type Preferences } from "../shared/preferences";

/** Settings → Plugins → zerosub. Accounts themselves live in the sidebar surface. */
export function PreferencesScreen({ theme, host, onOpenAccounts }: PluginSurfaceProps & { onOpenAccounts(): void }) {
  const settings = useSettings(preferences);
  const multiHost = useHosts().length > 1;
  const [prompt, setPrompt] = useState<string | null>(null);
  const muted = { color: theme.colors.foregroundMuted };
  if (settings.status === "loading") return <Text style={muted}>불러오는 중…</Text>;
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="환경설정">
        <Text style={{ color: theme.colors.statusDanger }}>{settings.error}</Text>
        <SettingsAction label="다시 시도" actionLabel="다시 불러오기" onPress={() => void settings.reload()} />
        {settings.status === "invalid" ? (
          <SettingsAction label="기본값으로 되돌리기" actionLabel="초기화" onPress={() => void settings.reset()} />
        ) : null}
      </SettingsSection>
    );
  }
  const save = (patch: Partial<Preferences>) =>
    void settings.save({ ...settings.values, ...patch }, settings.revision);
  return (
    <>
      {multiHost ? (
        <Text style={muted}>이 설정은 {host.label}의 에이전트에 적용됩니다. 호스트마다 계정과 설정을 따로 보관합니다.</Text>
      ) : null}
      <SettingsSection title="계정">
        <SettingsCard>
          <SettingsAction
            label="계정 추가·삭제와 기본 계정 선택"
            actionLabel="계정 열기"
            onPress={onOpenAccounts}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="자동 전환">
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
            hint="아래의 이어가기 메시지를 보내 멈춘 작업을 계속하게 합니다."
            value={settings.values.autoContinue}
            disabled={settings.saving || !settings.values.autoSwitch}
            onValueChange={(autoContinue) => save({ autoContinue })}
          />
          <SettingsInput
            label="이어가기 메시지"
            initialValue={settings.values.continuePrompt}
            onChangeText={setPrompt}
            disabled={settings.saving || !settings.values.autoContinue}
            error={settings.saveError}
          />
          <SettingsAction
            label="이어가기 메시지 저장"
            actionLabel="저장"
            disabled={settings.saving || prompt === null || !prompt.trim()}
            onPress={() => {
              if (prompt?.trim()) save({ continuePrompt: prompt.trim() });
            }}
          />
          <SettingsAction
            label="기본 이어가기 메시지로 되돌리기"
            actionLabel="되돌리기"
            disabled={settings.saving || settings.values.continuePrompt === DEFAULT_CONTINUE_PROMPT}
            onPress={() => save({ continuePrompt: DEFAULT_CONTINUE_PROMPT })}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="새 에이전트와 입력창">
        <SettingsCard>
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
            hint="멈춘 Claude 대화를 지금까지의 내용과 함께 새 ChatGPT 에이전트에서 이어갑니다(반대 방향도 마찬가지). 새 에이전트는 원래보다 더 많은 권한을 받지 않으며, 원래 대화는 그대로 남습니다."
            value={settings.values.forkOtherProvider}
            disabled={settings.saving || !settings.values.autoSwitch}
            onValueChange={(forkOtherProvider) => save({ forkOtherProvider })}
          />
          <SettingsSwitch
            label="입력창에 계정 버튼 표시"
            hint="한 서비스에 계정이 두 개 이상이면 Claude·Codex 에이전트의 입력창에 나타납니다."
            value={settings.values.showComposerPill}
            disabled={settings.saving}
            onValueChange={(showComposerPill) => save({ showComposerPill })}
          />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
