import type { PluginButtonContentProps } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useState, type ComponentType } from "react";
import { Text, View } from "react-native";
import { FAMILY_LABEL, type Family } from "../shared/model";
import { forkAgent } from "../shared/rpc";
import { describe, type ZeroSubStore } from "./store";
import { Button, useText } from "./ui";

/**
 * Confirmation for carrying a stopped agent's work on with the other provider. It starts a new agent
 * that goes straight to work, so it's worth a second look; refusals (say, no mode as careful as this
 * agent's) show right here.
 */
export function forkPopover(store: ZeroSubStore, agentId: string, from: Family, to: Family): ComponentType<PluginButtonContentProps> {
  return function ForkPopover({ theme, close }: PluginButtonContentProps) {
    const toast = useToast();
    const text = useText(theme);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const start = async () => {
      setBusy(true);
      setError(null);
      try {
        const fork = await store.rpc(forkAgent, { agentId });
        close();
        toast.show(`${FAMILY_LABEL[to]}의 “${fork.title}”에서 이어갑니다`, { variant: "success", durationMs: 5_000 });
      } catch (failure) {
        setError(describe(failure));
        setBusy(false);
      }
    };

    return (
      <View style={{ gap: 12, maxWidth: 360 }}>
        <Text style={text.heading}>{FAMILY_LABEL[to]}에서 이어갈까요?</Text>
        <Text style={text.body}>
          모든 {FAMILY_LABEL[from]} 계정이 한도에 닿았습니다. 이 작업 공간에 지금까지의 대화를 담은 새 {FAMILY_LABEL[to]} 에이전트를
          시작합니다. 새 에이전트는 이 에이전트보다 더 많은 권한을 받지 않으며, 이 에이전트는 그대로 남습니다.
        </Text>
        {error ? <Text style={text.danger}>{error}</Text> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
          <Button theme={theme} label="나중에" tooltip="새 에이전트를 시작하지 않고 닫습니다" tooltipAlign="end" onPress={close} disabled={busy} />
          <Button
            theme={theme}
            tone="primary"
            icon="GitFork"
            label={`${FAMILY_LABEL[to]}에서 이어가기`}
            tooltip={`지금까지의 대화로 새 ${FAMILY_LABEL[to]} 에이전트를 시작합니다`}
            tooltipAlign="end"
            busy={busy}
            onPress={() => void start()}
          />
        </View>
      </View>
    );
  };
}
