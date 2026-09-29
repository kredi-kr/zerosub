import type { AccountView, UsageWindow } from "./model";

/** "2시간 14분 후", "3일 4시간 후", "지금". */
export function formatResetIn(resetsAt: string | null, now: number = Date.now()): string | null {
  if (!resetsAt) return null;
  const at = Date.parse(resetsAt);
  if (!Number.isFinite(at)) return null;
  const minutes = Math.round((at - now) / 60_000);
  if (minutes <= 0) return "지금";
  if (minutes < 60) return `${minutes}분 후`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours}시간 후` : `${hours}시간 ${rest}분 후`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}일 후` : `${days}일 ${restHours}시간 후`;
}

export function formatPercent(value: number): string {
  return `${Math.round(Math.min(100, Math.max(0, value)))}%`;
}

/** The busiest window decides how close an account is to being cut off. */
export function peakUsage(windows: readonly UsageWindow[]): UsageWindow | null {
  let peak: UsageWindow | null = null;
  for (const limit of windows) {
    if (!peak || limit.usedPercent > peak.usedPercent) peak = limit;
  }
  return peak;
}

const PLAN_LABELS: Record<string, string> = {
  max: "Max",
  pro: "Pro",
  prolite: "Pro Lite",
  team: "Team",
  enterprise: "Enterprise",
  plus: "Plus",
  go: "Go",
  business: "Business",
  self_serve_business_prolite: "Business",
  self_serve_business_usage_based: "Business",
  enterprise_cbp_automation: "Enterprise",
  enterprise_cbp_usage_based: "Enterprise",
  ent26: "Enterprise",
  edu: "Edu",
  edu_plus: "Edu Plus",
  edu_pro: "Edu Pro",
  free: "Free",
};

export function formatPlan(plan: string | null): string | null {
  if (!plan) return null;
  const key = plan.toLowerCase();
  return PLAN_LABELS[key] ?? plan.charAt(0).toUpperCase() + plan.slice(1);
}

/** Short name for a composer pill: the nickname, trimmed to fit. */
export function shortLabel(account: Pick<AccountView, "label">, max = 18): string {
  const label = account.label.trim();
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}

/**
 * The line under an account's name: its email, plus its organization when that adds something.
 * Claude names a personal organization after its owner ("…'s Organization"), which only repeats it.
 */
export function accountSubtitle(account: Pick<AccountView, "email" | "organization">): string | null {
  const organization = account.organization?.trim() || null;
  const telling =
    organization && organization.toLowerCase() !== account.email?.toLowerCase() && !/'s organi[sz]ation$/i.test(organization)
      ? organization
      : null;
  return [account.email, telling].filter(Boolean).join(" · ") || null;
}

/** "방금", "6분 전", "3시간 전", "2일 전". */
export function formatAge(at: string, now: number = Date.now()): string {
  const minutes = Math.floor((now - Date.parse(at)) / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}시간 전` : `${Math.round(hours / 24)}일 전`;
}

/** One line summarising an account's headroom, e.g. "5시간 42% 사용 · 2시간 후 초기화". */
export function usageSummary(account: AccountView, now: number = Date.now()): string | null {
  if (account.status === "disabled") return "잠시 사용 중지됨";
  if (account.status === "limited") {
    const reset = formatResetIn(account.limitedUntil, now);
    return reset ? `한도 도달 · ${reset} 초기화` : "한도 도달";
  }
  const peak = account.usage ? peakUsage(account.usage.windows) : null;
  if (!peak) return null;
  const reset = formatResetIn(peak.resetsAt, now);
  const base = `${peak.label} ${formatPercent(peak.usedPercent)} 사용`;
  return reset ? `${base} · ${reset} 초기화` : base;
}
