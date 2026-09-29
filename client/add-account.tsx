import { openExternalUrl, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { copyText, Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { formatPlan } from "../shared/format";
import { FAMILY_LABEL, type Family, type LoginMethod, type LoginView } from "../shared/model";
import { cancelLogin, startLogin, submitLoginCode } from "../shared/rpc";
import { describe, useStore, type ZeroSubStore } from "./store";
import { Button, useText } from "./ui";

type Theme = PluginSurfaceProps["theme"];

export function AddAccountModal({
  theme,
  layout,
  host,
  multiHost,
  store,
  family,
  accountId,
  onClose,
}: {
  theme: Theme;
  layout: PluginSurfaceProps["layout"];
  host: PluginSurfaceProps["host"];
  /** The app knows several hosts, so say which one gets the account. */
  multiHost: boolean;
  store: ZeroSubStore;
  family: Family;
  accountId?: string;
  onClose(): void;
}) {
  const text = useText(theme);
  const { state } = useStore(store);
  // A browser sign-in finishes by redirecting to `localhost` on the host's computer, so it only
  // works from a browser there, and never on hosts without a desktop (servers, containers).
  // Phones start with a code; the browser stays on offer for someone at the host's computer.
  const mobile = layout.platform === "ios" || layout.platform === "android";
  const hostBrowser = state?.browserSignIn !== false;
  const [method, setMethod] = useState<LoginMethod>(hostBrowser && !mobile ? "browser" : "code");
  const [loginId, setLoginId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  // Each start gets a number; only the newest one's answer counts.
  const attempt = useRef(0);
  const closed = useRef(false);

  const begin = useCallback(
    async (next: LoginMethod) => {
      const mine = ++attempt.current;
      setStartError(null);
      setLoginId(null);
      try {
        const login = await store.rpc(startLogin, { family, accountId, method: next });
        // The modal closed (or a newer start replaced this one) before the daemon answered.
        if (closed.current || mine !== attempt.current) {
          void store.rpc(cancelLogin, { loginId: login.id }).catch(() => undefined);
          return;
        }
        setLoginId(login.id);
      } catch (error) {
        if (!closed.current && mine === attempt.current) setStartError(describe(error));
      }
    },
    [store, family, accountId],
  );

  useEffect(() => {
    if (attempt.current === 0) void begin(method);
  }, [begin, method]);

  useEffect(() => store.watchClosely(), [store]);

  const login = state?.logins.find((entry) => entry.id === loginId) ?? null;
  const account = login?.accountId ? state?.accounts.find((entry) => entry.id === login.accountId) : undefined;
  const finished = login ? login.step === "done" || login.step === "failed" || login.step === "canceled" : false;

  const close = useCallback(() => {
    closed.current = true;
    if (loginId && !finished) void store.rpc(cancelLogin, { loginId }).catch(() => undefined);
    onClose();
  }, [loginId, finished, store, onClose]);

  // Claude's flow serves both links at once; ChatGPT needs a fresh flow to switch.
  const switchMethod = useCallback(
    (next: LoginMethod) => {
      setMethod(next);
      if (family === "codex") void begin(next);
    },
    [family, begin],
  );

  const title = accountId ? "다시 로그인" : `${FAMILY_LABEL[family]} 계정 추가`;
  let body: ReactNode;
  if (startError) {
    body = (
      <>
        <Text style={text.danger}>{startError}</Text>
        <Row>
          <Button theme={theme} label="닫기" tooltip="계정을 추가하지 않고 닫습니다" tooltipAlign="end" onPress={close} />
          <Button
            theme={theme}
            tone="primary"
            icon="RefreshCw"
            label="다시 시도"
            tooltip="로그인을 처음부터 다시 시작합니다"
            tooltipAlign="end"
            onPress={() => void begin(method)}
          />
        </Row>
      </>
    );
  } else if (!login || login.step === "starting") {
    body = <Waiting theme={theme} label="로그인 준비 중…" />;
  } else if (login.step === "waiting") {
    body = (
      <SignInSteps
        theme={theme}
        store={store}
        login={login}
        family={family}
        method={method}
        browserUsable={hostBrowser}
        onSwitch={switchMethod}
      />
    );
  } else if (login.step === "verifying") {
    body = <Waiting theme={theme} label="계정 확인 중…" />;
  } else if (login.step === "done") {
    const who = account
      ? `${account.label}${account.email && account.email !== account.label ? ` (${account.email})` : ""}${
          account.plan ? ` · ${formatPlan(account.plan)}` : ""
        }`
      : "계정";
    body = (
      <>
        <Text style={text.heading}>로그인되었습니다</Text>
        <Text style={text.body}>
          {who} 계정을 쓸 준비가 되었습니다. {multiHost ? `${host.label}의 ` : ""}새 {FAMILY_LABEL[family]} 에이전트가 이 계정을 쓸 수
          있고, 메시지 입력창의 계정 버튼에서 기존 에이전트를 이 계정으로 옮길 수도 있습니다.
        </Text>
        <Row>
          <Button theme={theme} tone="primary" label="완료" tooltip="이 창을 닫습니다" tooltipAlign="end" onPress={onClose} />
        </Row>
      </>
    );
  } else {
    body = (
      <>
        <Text style={login.step === "failed" ? text.danger : text.muted}>
          {login.message ?? (login.step === "canceled" ? "로그인이 취소되었습니다." : "로그인하지 못했습니다.")}
        </Text>
        <Row>
          <Button theme={theme} label="닫기" tooltip="계정을 추가하지 않고 닫습니다" tooltipAlign="end" onPress={close} />
          <Button
            theme={theme}
            tone="primary"
            icon="RefreshCw"
            label="다시 시도"
            tooltip="로그인을 처음부터 다시 시작합니다"
            tooltipAlign="end"
            onPress={() => void begin(method)}
          />
        </Row>
      </>
    );
  }

  return (
    <Modal title={title} open onOpenChange={(open) => (open ? undefined : close())}>
      <Modal.Content>
        {multiHost && !accountId && login?.step !== "done" ? (
          <Text style={text.small}>{host.label}에만 계정을 추가합니다. 다른 호스트에서는 따로 로그인하세요.</Text>
        ) : null}
        {body}
      </Modal.Content>
    </Modal>
  );
}

function SignInSteps({
  theme,
  store,
  login,
  family,
  method,
  browserUsable,
  onSwitch,
}: {
  theme: Theme;
  store: ZeroSubStore;
  login: LoginView;
  family: Family;
  method: LoginMethod;
  /** A browser on the host's computer can finish the sign-in, so offer that route too. */
  browserUsable: boolean;
  onSwitch(method: LoginMethod): void;
}) {
  const text = useText(theme);
  const toast = useToast();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  // Claude: the browser link completes by itself; the code link works from any device.
  const pasteFlow = family === "claude" && (method === "code" || !login.url) && Boolean(login.codeUrl);
  const link = pasteFlow ? login.codeUrl : login.url ?? login.codeUrl;

  const open = useCallback(() => {
    if (link) void openExternalUrl(link).catch((error: unknown) => toast.error(describe(error)));
  }, [link, toast]);
  const copy = useCallback(
    async (value: string, what: string) => {
      try {
        await copyText(value);
        toast.show(`${what}를 복사했습니다`, { variant: "success" });
      } catch {
        toast.error("복사하지 못했습니다. 글자를 직접 선택해 복사하세요.");
      }
    },
    [toast],
  );
  const submit = useCallback(async () => {
    const value = code.trim();
    if (!value) return;
    setSubmitting(true);
    setCodeError(null);
    try {
      await store.rpc(submitLoginCode, { loginId: login.id, code: value });
    } catch (error) {
      setCodeError(describe(error));
    } finally {
      setSubmitting(false);
    }
  }, [code, login.id, store]);

  const inputStyle = useMemo(
    () => ({
      color: theme.colors.foreground,
      backgroundColor: theme.colors.surface2,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
    }),
    [theme],
  );

  const service = family === "claude" ? "Claude" : "ChatGPT";
  const canSwitch = browserUsable && (family === "codex" || (Boolean(login.url) && Boolean(login.codeUrl)));
  return (
    <View style={{ gap: 16 }}>
      <Step theme={theme} number={1} title={`${service} 로그인 페이지 열기`}>
        <Text style={text.muted}>
          {pasteFlow || login.userCode
            ? "추가할 계정으로 로그인하세요. 휴대폰을 포함해 어떤 기기에서든 됩니다."
            : "호스트 컴퓨터의 브라우저에서 추가할 계정으로 로그인하세요. 로그인하면 저절로 마무리됩니다."}
        </Text>
        <Row start>
          <Button
            theme={theme}
            tone="primary"
            icon="ExternalLink"
            label="로그인 페이지 열기"
            tooltip={`브라우저에서 ${service} 로그인 페이지를 엽니다`}
            tooltipAlign="start"
            disabled={!link}
            onPress={open}
          />
          {link ? (
            <Button
              theme={theme}
              icon="Copy"
              label="링크 복사"
              tooltip="로그인 링크를 복사합니다. 다른 기기에서 열 때 쓰세요"
              tooltipAlign="start"
              onPress={() => void copy(link, "링크")}
            />
          ) : null}
        </Row>
      </Step>

      {login.userCode ? (
        <Step theme={theme} number={2} title="그 페이지에 이 코드를 입력하세요">
          <Text selectable style={text.mono}>
            {login.userCode}
          </Text>
          <Row start>
            <Button
              theme={theme}
              icon="Copy"
              label="코드 복사"
              tooltip="로그인 페이지에 입력할 코드를 복사합니다"
              tooltipAlign="start"
              onPress={() => void copy(login.userCode ?? "", "코드")}
            />
          </Row>
          <Text style={text.small}>
            페이지에 코드 로그인이 꺼져 있다고 나오면, ChatGPT → 설정 → 보안에서 기기 코드 로그인을 켠 뒤(또는 워크스페이스
            관리자에게 요청한 뒤) 다시 시도하세요.
          </Text>
        </Step>
      ) : null}

      {pasteFlow ? (
        <Step theme={theme} number={2} title="로그인 후 나오는 코드를 붙여넣으세요">
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="코드 붙여넣기"
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={() => void submit()}
            style={inputStyle}
            accessibilityLabel="로그인 코드"
          />
          {codeError ? <Text style={text.danger}>{codeError}</Text> : null}
          <Row start>
            <Button
              theme={theme}
              tone="primary"
              label="계속"
              tooltip="붙여넣은 코드로 로그인을 마칩니다"
              tooltipAlign="start"
              busy={submitting}
              disabled={!code.trim()}
              onPress={() => void submit()}
            />
          </Row>
        </Step>
      ) : (
        <Waiting theme={theme} label="로그인을 마칠 때까지 기다리는 중…" />
      )}

      {login.message ? <Text style={text.small}>{login.message}</Text> : null}

      {canSwitch ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onSwitch(method === "code" ? "browser" : "code")}
          style={{ alignSelf: "flex-start", paddingVertical: 4 }}
        >
          <Text style={{ color: theme.colors.accent, fontSize: 13, fontWeight: "600" }}>
            {method === "code" ? "호스트 컴퓨터 앞에 있나요? 그 컴퓨터의 브라우저로 로그인하기" : "다른 기기에서 하나요? 코드로 로그인하기"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Step({ theme, number, title, children }: { theme: Theme; number: number; title: string; children: ReactNode }) {
  const text = useText(theme);
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 12,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.surface2,
        }}
      >
        <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "700" }}>{number}</Text>
      </View>
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={text.strong}>{title}</Text>
        {children}
      </View>
    </View>
  );
}

function Waiting({ theme, label }: { theme: Theme; label: string }) {
  const text = useText(theme);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}>
      <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
      <Text style={text.muted}>{label}</Text>
    </View>
  );
}

function Row({ children, start }: { children: ReactNode; start?: boolean }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: start ? "flex-start" : "flex-end" }}>
      {children}
    </View>
  );
}
