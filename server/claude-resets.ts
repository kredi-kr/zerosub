import type { ResetOffer } from "../shared/model";
import type { RedeemReply } from "./adapter";

/**
 * Claude's banked "limit reset" (Claude Code's hidden `/limit-reset`, program `cedar_ember`).
 * Status arrives as a `cedar_ember` block in `/api/oauth/usage?cedar_ember=1`; redeeming posts the
 * next grant to `/api/organizations/{org}/reset_rate_limits`. Field names follow Claude Code 2.1.x.
 */
export const CLAUDE_RESET_PROGRAM = "cedar_ember";
export const GRANT_ID = /^[a-z0-9_-]{1,40}$/;

const LIMIT_LABELS: Record<string, string> = {
  five_hour: "5시간",
  seven_day: "주간",
  seven_day_opus: "Opus 주간",
  seven_day_sonnet: "Sonnet 주간",
  seven_day_overage_included: "Fable 주간",
};

const INELIGIBLE: Record<string, string> = {
  config_off: "이 계정에는 한도 초기화 기능이 켜져 있지 않습니다.",
  tier: "이 요금제에는 한도 초기화가 포함되어 있지 않습니다.",
  seat: "이 좌석 유형에는 한도 초기화가 포함되어 있지 않습니다.",
  mobile: "휴대폰에서 구입한 한도 초기화권은 휴대폰에서만 쓸 수 있습니다.",
  surface: "이 한도 초기화권은 Claude Code에서 쓸 수 없습니다.",
  cli_version: "이 한도 초기화권을 쓰려면 Claude Code를 업데이트하세요.",
  no_grant: "이 계정에 한도 초기화권이 없습니다.",
  tenure: "이 계정은 아직 한도 초기화를 쓸 수 없습니다.",
  other_experiment: "이 계정은 다른 한도 실험에 포함되어 있어 한도 초기화를 쓸 수 없습니다.",
  unavailable: "지금은 한도 초기화를 쓸 수 없습니다.",
};

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function limitTypes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function labels(types: readonly string[]): string[] {
  return [...new Set(types.map((type) => LIMIT_LABELS[type] ?? "주간"))];
}

function joinLabels(types: readonly string[]): string {
  const names = labels(types);
  if (names.length <= 1) return names[0] ?? "사용량";
  return `${names.slice(0, -1).join(", ")} 및 ${names.at(-1)}`;
}

function isoTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

interface Grant {
  id: string;
  label: string;
  resetsLeft: number;
  endsAt: string | null;
  clears: string[];
  paused: boolean;
  usableNow: boolean;
  useRequiresLimit: boolean;
  blocking: string[];
}

function parseGrant(value: unknown): Grant | null {
  if (!isObject(value) || typeof value.id !== "string" || !GRANT_ID.test(value.id)) return null;
  const left = value.resets_left;
  if (typeof left !== "number" || !Number.isInteger(left) || left < 0) return null;
  return {
    id: value.id,
    label: typeof value.label === "string" ? value.label : "",
    resetsLeft: left,
    endsAt: isoTime(value.ends_at),
    clears: limitTypes(value.clears),
    paused: value.paused === true,
    usableNow: value.usable_now === true,
    useRequiresLimit: value.use_requires_limit !== false,
    blocking: limitTypes(value.blocking),
  };
}

export interface ClaudeResetStatus {
  offer: ResetOffer | null;
  /** The grant the server will accept next; claims for any other grant are refused. */
  nextGrantId: string | null;
  /** Claude sees the account at a usage limit right now. */
  atLimit: boolean;
}

/** Reads the `cedar_ember` block. `offer` is null when nothing is banked. */
export function parseClaudeResets(block: unknown, now: number = Date.now()): ClaudeResetStatus {
  if (!isObject(block)) return { offer: null, nextGrantId: null, atLimit: false };
  const atLimit = block.at_limit === true;
  const grants = (Array.isArray(block.grants) ? block.grants : []).map(parseGrant).filter((grant): grant is Grant => grant !== null);
  const available = grants.reduce((sum, grant) => sum + grant.resetsLeft, 0);
  if (available === 0) return { offer: null, nextGrantId: null, atLimit };

  const nextId = typeof block.next_grant_id === "string" && grants.some((grant) => grant.id === block.next_grant_id) ? block.next_grant_id : null;
  const next = grants.find((grant) => grant.id === nextId) ?? grants.find((grant) => grant.resetsLeft > 0) ?? null;
  const eligible = block.eligible === true;
  const cooldown = isoTime(block.cooldown_until);

  let blockedReason: string | null = null;
  if (!eligible) {
    const reason = typeof block.ineligible_reason === "string" ? block.ineligible_reason : "unavailable";
    blockedReason = INELIGIBLE[reason] ?? INELIGIBLE.unavailable ?? null;
  } else if (cooldown && Date.parse(cooldown) > now) {
    blockedReason = `${new Date(cooldown).toLocaleString("ko-KR")}까지는 한도 초기화를 다시 쓸 수 없습니다.`;
  } else if (!next || !nextId) {
    blockedReason = "지금은 쓸 수 없습니다.";
  } else if (next.paused) {
    blockedReason = "이 한도 초기화권은 지금 일시 중지되어 있습니다.";
  } else if (next.blocking.length > 0) {
    blockedReason = `이 한도 초기화권은 ${joinLabels(next.blocking)} 한도를 채워 주지 않으므로, 그 한도가 초기화될 때까지 쓸 수 없습니다.`;
  } else if (next.useRequiresLimit && !atLimit) {
    blockedReason = "이 계정이 한도에 도달하면 쓸 수 있습니다.";
  } else if (!next.usableNow) {
    blockedReason = "지금은 쓸 수 없습니다. 1분 뒤 다시 시도하세요.";
  }

  return {
    nextGrantId: nextId,
    atLimit,
    offer: {
      available,
      usableNow: blockedReason === null,
      blockedReason,
      expiresAt: next?.endsAt ?? null,
      refills: next ? labels(next.clears) : [],
      label: next?.label.trim() || null,
    },
  };
}

/** A one-line, secret-free summary of the `cedar_ember` block, for the plugin log. */
export function describeResetBlock(block: unknown): string {
  if (block === undefined || block === null) return "not offered to this account (no reset program in the usage reply)";
  if (!isObject(block)) return "unreadable reset status";
  const grants = Array.isArray(block.grants) ? block.grants.length : 0;
  const left = (Array.isArray(block.grants) ? block.grants : [])
    .map(parseGrant)
    .reduce((sum, grant) => sum + (grant?.resetsLeft ?? 0), 0);
  const eligibility = block.eligible === true ? "eligible" : `not eligible (${String(block.ineligible_reason ?? "unknown")})`;
  const props = isObject(block.event_props) ? block.event_props : {};
  const seenAs = [props.surface, props.tier].filter((value) => typeof value === "string").join("/");
  return `${eligibility}, ${grants} grant(s), ${left} reset(s) left${block.at_limit === true ? ", at a limit" : ""}${
    seenAs ? ` [seen as ${seenAs}]` : ""
  }`;
}

/** Turns the claim endpoint's reply into an outcome and a sentence for the user. */
export function readClaimReply(body: unknown): RedeemReply {
  if (!isObject(body) || typeof body.result !== "string") {
    return { outcome: "error", message: "Claude가 알아볼 수 없는 응답을 보냈습니다. 다시 시도하기 전에 이 계정의 사용량을 확인하세요.", left: null };
  }
  const left = typeof body.resets_left === "number" ? body.resets_left : null;
  const leftText = left === null ? "" : ` · ${left}개 남음`;
  switch (body.result) {
    case "reset": {
      const cleared = limitTypes(body.cleared);
      return { outcome: "reset", message: `한도가 초기화되었습니다${cleared.length ? ` (${joinLabels(cleared)})` : ""}${leftText}.`, left };
    }
    case "already_used":
      return { outcome: "already_used", message: `이미 사용된 한도 초기화권입니다${leftText}.`, left };
    case "not_limited":
      return {
        outcome: "not_limited",
        message: "이 계정은 지금 사용 한도에 도달하지 않아 한도 초기화권을 쓰지 않고 남겨 두었습니다. 계정이 한도에 도달하면 사용하세요.",
        left,
      };
    case "cooldown": {
      const until = isoTime(body.cooldown_until);
      return {
        outcome: "cooldown",
        message: `한도 초기화를 잠시 쓸 수 없습니다${until ? ` (${new Date(until).toLocaleString("ko-KR")}까지)` : ""}. 한도 초기화권은 그대로 남아 있습니다.`,
        left,
      };
    }
    case "ineligible": {
      const reason = typeof body.reason === "string" ? INELIGIBLE[body.reason] : undefined;
      return { outcome: "unavailable", message: reason ?? "이 계정은 지금 한도 초기화권을 쓸 수 없습니다. 한도 초기화권은 그대로 남아 있습니다.", left };
    }
    default:
      return { outcome: "unavailable", message: "지금은 한도 초기화를 쓸 수 없습니다. 한도 초기화권은 그대로 남아 있습니다.", left };
  }
}
