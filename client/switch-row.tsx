import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Text, View } from "react-native";
import { formatResetIn } from "../shared/format";
import { FAMILY_LABEL } from "../shared/model";
import type { SwitchRow } from "../shared/timeline";

function cause(row: SwitchRow): string | null {
  const reset = formatResetIn(row.resetsAt);
  const from = row.from ?? "이전 계정";
  switch (row.reason) {
    case "limit":
      return `${from} 계정이 사용 한도에 닿았습니다${reset ? ` (${reset} 초기화)` : ""}.`;
    case "signed_out":
      return `${from} 계정이 로그아웃되었습니다. 계정 화면에서 다시 로그인하세요.`;
    case "removed":
      return `${from} 계정이 삭제되었습니다.`;
    case "disabled":
      return `${from} 계정의 사용이 잠시 중지되었습니다.`;
    case "enabled":
      return `${row.to} 계정을 다시 사용합니다.`;
    case "default":
      return "기본 계정이 바뀌었습니다.";
    default:
      return null;
  }
}

/** The work went on in a new agent on the other provider (Claude ↔ ChatGPT). */
function isFork(row: SwitchRow): boolean {
  return row.toFamily !== null && row.toFamily !== row.family;
}

export function describeRow(row: SwitchRow): string {
  if (isFork(row) && row.toFamily && row.continuedIn) {
    const reset = formatResetIn(row.resetsAt);
    const lead =
      row.reason === "exhausted"
        ? `모든 ${FAMILY_LABEL[row.family]} 계정이 한도에 닿아${reset ? ` (${row.from ?? "이 계정"}은 ${reset} 초기화)` : ""} `
        : "";
    return `${lead}${FAMILY_LABEL[row.toFamily]}의 새 에이전트에서 작업을 이어갑니다: “${row.continuedIn.title}” (${row.to}).`;
  }
  if (row.reason === "exhausted") {
    const reset = formatResetIn(row.resetsAt);
    return `모든 ${FAMILY_LABEL[row.family]} 계정이 한도에 닿았습니다${
      reset ? `. ${row.from ?? "이 계정"}은 ${reset} 초기화됩니다` : ""
    }. 계정을 더 추가하거나, 계정 버튼에서 한도 초기화권을 쓰거나, 초기화될 때까지 기다리세요.${row.detail ? ` ${row.detail}` : ""}`;
  }
  if (row.outcome === "reset") {
    return `${row.from ?? "이 계정"} 계정이 사용 한도에 닿아 한도 초기화권을 썼습니다. ${row.detail ?? "한도가 초기화되었습니다."}${
      row.continued ? " 하던 일을 이어갑니다." : ""
    }`;
  }
  const why = cause(row);
  const lead = why ? `${why} ` : "";
  switch (row.outcome) {
    case "continued":
      return row.continuedIn
        ? `${lead}ChatGPT 대화는 도중에 계정을 바꿀 수 없어, ${row.to} 계정의 새 에이전트에서 이어갑니다: “${row.continuedIn.title}”.`
        : `${lead}${row.to} 계정에서 이어갑니다.`;
    case "stayed":
      return `${lead}이 대화는 ${row.from ?? "원래 계정"}에 그대로 남습니다.${row.detail ? ` ${row.detail}` : ""}`;
    case "pending":
      return `${lead}다음에 세션이 시작될 때 ${row.to} 계정으로 옮깁니다.`;
    default: {
      const from =
        row.from && row.reason !== "limit" && row.reason !== "signed_out" && row.reason !== "disabled" ? `${row.from}에서 ` : "";
      return `${lead}${from}${row.to} 계정으로 바꿨습니다${row.continued ? ". 하던 일을 이어갑니다" : ""}.`;
    }
  }
}

/** Inline note in an agent's timeline when ZeroSub moved it to another account. */
export function SwitchRowView({ item, theme }: PluginTimelineItemProps<SwitchRow>) {
  const row = item.data;
  const forked = isFork(row);
  const warning =
    !forked && (row.reason === "limit" || row.reason === "signed_out" || row.reason === "exhausted" || row.outcome === "stayed");
  const icon = forked
    ? "GitFork"
    : row.reason === "exhausted" || row.outcome === "stayed"
      ? "CircleAlert"
      : row.outcome === "continued"
        ? "CopyPlus"
        : row.outcome === "reset"
          ? "TimerReset"
          : "ArrowRightLeft";
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        alignSelf: "flex-start",
        maxWidth: "100%",
      }}
    >
      <Icon name={icon} size={14} color={warning ? theme.colors.statusWarning : theme.colors.foregroundMuted} />
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, flexShrink: 1 }}>{describeRow(row)}</Text>
    </View>
  );
}
