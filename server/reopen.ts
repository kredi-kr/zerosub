import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { paseoHome } from "./paths";

/**
 * Reopens an agent's provider session so it picks up a new account.
 *
 * The plugin SDK has no session reopen (`agents.ref(id).refresh()` only refetches data), so this
 * uses the bundled CLI's `paseo agent reload`, which the daemon implements as close + reopen with
 * the current configuration. The CLI connects on its own; on a password-protected daemon it cannot,
 * and the switch then applies the next time the session opens.
 */
export class Reopener {
  private cli: { at: number; path: Promise<string | null> } | null = null;

  /** Path to the CLI, or null when none can be found (looked for again every few minutes). */
  async locate(): Promise<string | null> {
    if (this.cli && (Date.now() - this.cli.at < 5 * 60_000 || (await this.cli.path) !== null)) return this.cli.path;
    this.cli = { at: Date.now(), path: findCli() };
    return this.cli.path;
  }

  /** `timedOut`: the command was stopped before the daemon answered, so the reload may still finish. */
  async reopen(agentId: string): Promise<{ ok: true } | { ok: false; error: string; timedOut: boolean }> {
    const cli = await this.locate();
    if (!cli) return { ok: false, error: "Paseo 데몬이 실행 중인 컴퓨터에서 paseo 명령어 도구를 찾지 못했습니다.", timedOut: false };
    return new Promise((resolve) => {
      execFile(
        cli,
        ["agent", "reload", agentId, "--json", "--home", paseoHome()],
        { timeout: 90_000, maxBuffer: 1024 * 1024, env: process.env },
        (error, _stdout, stderr) => {
          if (!error) return resolve({ ok: true });
          const detail = `${stderr || error.message}`.trim().split("\n").slice(-3).join(" ");
          resolve({ ok: false, error: explainFailure(detail), timedOut: error.killed === true });
        },
      );
    });
  }
}

function explainFailure(detail: string): string {
  if (/transport closed|cannot connect|cannot reach|password|unauthori[sz]ed|DAEMON_NOT_RUNNING/i.test(detail)) {
    return "Paseo 명령어 도구가 이 Paseo 데몬에 연결하지 못했습니다 (비밀번호가 필요할 수 있습니다). 에이전트는 다음에 세션이 시작될 때 계정을 바꿉니다.";
  }
  return detail || "다시 불러오기에 실패했습니다.";
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findCli(): Promise<string | null> {
  const candidates: string[] = [];
  const executable = process.platform === "win32" ? "paseo.cmd" : "paseo";

  // The daemon (and this subprocess) usually run inside the desktop app bundle, which ships the CLI.
  const exec = process.execPath;
  const appContents = exec.match(/^(.*?\.app\/Contents)\//)?.[1];
  if (appContents) candidates.push(join(appContents, "Resources", "bin", "paseo"));
  const resources = findAncestor(exec, "resources");
  if (resources) candidates.push(join(resources, "bin", executable));

  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory) candidates.push(join(directory, executable));
  }

  if (process.platform === "darwin") {
    candidates.push("/Applications/Paseo.app/Contents/Resources/bin/paseo");
    candidates.push(join(homedir(), "Applications", "Paseo.app", "Contents", "Resources", "bin", "paseo"));
  }
  candidates.push(join(homedir(), ".local", "bin", executable));

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

function findAncestor(path: string, name: string): string | null {
  let current = dirname(path);
  for (let depth = 0; depth < 6; depth += 1) {
    if (current.toLowerCase().endsWith(`/${name}`) || current.toLowerCase().endsWith(`\\${name}`)) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
