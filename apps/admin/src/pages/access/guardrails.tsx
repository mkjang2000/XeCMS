import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { toAdminApiError } from "@xecms/admin";
import { Button, Callout } from "@xecms/ui";
import styles from "../../authorization.module.css";
import { useDisplayMode, type DisplayMode } from "../../display-mode.js";

/**
 * 간단 모드에서 표현할 수 없는 고급 설정을 만났을 때의 안내.
 * 파괴적 단순화 대신 상위 모드로 안내한다. 오류가 아니라 정보성 톤.
 */
export function AdvancedConfigNotice({
  message,
  reasons = [],
  targetMode = "standard",
  to,
  actionLabel,
}: {
  readonly message: string;
  readonly reasons?: readonly string[];
  readonly targetMode?: DisplayMode;
  readonly to: string;
  readonly actionLabel?: string;
}) {
  const { setMode } = useDisplayMode();
  const navigate = useNavigate();
  return (
    <Callout tone="info">
      <strong>{message}</strong>
      {reasons.length > 0 ? (
        <ul className={styles.noticeReasons}>
          {reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      ) : null}
      <div className={styles.noticeActions}>
        <Button
          size="small"
          variant="secondary"
          onPress={() => {
            setMode(targetMode, { auto: true });
            void navigate(to);
          }}
        >
          {actionLabel ?? (targetMode === "advanced" ? "고급 모드에서 열기" : "표준 모드에서 열기")}
        </Button>
      </div>
    </Callout>
  );
}

const managementReasonMessages: Readonly<Record<string, string>> = {
  TARGET_NOT_LOWER: "내 등급보다 높거나 같은 등급은 변경할 수 없어요.",
  PROTECTED_TARGET: "시스템이 보호하는 항목이라 변경할 수 없어요.",
  PROTECTED_PERMISSION: "시스템이 보호하는 권한이라 변경할 수 없어요.",
  SELF_BINDING_MUTATION: "내 계정의 권한은 스스로 바꿀 수 없어요.",
  SELF_SUBJECT_MUTATION: "내 계정의 권한은 스스로 바꿀 수 없어요.",
  DELEGATION_NOT_ALLOWED: "이 권한은 아래 등급에 넘겨줄 수 없도록 보호되어 있어요.",
  NON_DELEGATABLE_PERMISSION: "이 권한은 아래 등급에 넘겨줄 수 없도록 보호되어 있어요.",
  NO_SINGLE_GRANT_SATISFIES_MANAGEMENT: "이 변경을 승인할 수 있는 관리 권한이 부족해요.",
  BINDING_ALREADY_EXISTS: "이미 같은 배정이 있어요.",
  NO_PERMISSION: "이 작업을 할 수 있는 권한이 없어요.",
  SUBJECT_DISABLED: "비활성화된 계정이라 변경할 수 없어요.",
};

export function policyErrorMessage(error: unknown): {
  readonly message: string;
  readonly conflict: boolean;
  readonly technical?: string;
} {
  const converted = toAdminApiError(error);
  if (converted.status === 409) {
    return {
      message: "다른 관리자가 방금 권한을 변경했어요. 최신 내용을 불러왔으니 다시 시도해 주세요.",
      conflict: true,
      technical: converted.code,
    };
  }
  const details = converted.details as { readonly decision?: { readonly reasonCode?: string } } | undefined;
  const reasonCode = details?.decision?.reasonCode;
  const friendly = reasonCode === undefined ? undefined : managementReasonMessages[reasonCode];
  if (friendly !== undefined) {
    return { message: friendly, conflict: false, technical: reasonCode };
  }
  return {
    message: converted.message,
    conflict: false,
    technical: reasonCode,
  };
}

/**
 * 정책 뮤테이션 오류를 평이한 한국어로 표시한다.
 * 409 충돌은 정책 쿼리를 무효화해 최신 상태로 복구한다.
 */
export function PolicyMutationError({
  error,
  policyKey,
}: {
  readonly error: unknown;
  readonly policyKey: readonly string[];
}) {
  const queryClient = useQueryClient();
  const hasError = error !== null && error !== undefined;
  const conflictError = hasError && policyErrorMessage(error).conflict;
  useEffect(() => {
    if (conflictError) void queryClient.invalidateQueries({ queryKey: policyKey });
  }, [conflictError, error, policyKey, queryClient]);
  if (!hasError) return null;
  const { message, conflict, technical } = policyErrorMessage(error);
  return (
    <Callout tone="error">
      <strong>{message}</strong>
      {technical !== undefined && !conflict ? <div className={styles.hint}>판정 코드: {technical}</div> : null}
    </Callout>
  );
}
