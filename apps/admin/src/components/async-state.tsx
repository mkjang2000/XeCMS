import { Button, Callout, LoadingIndicator } from "@xecms/ui";
import { toAdminApiError } from "@xecms/admin";
import { useNavigate } from "react-router";

export function PageLoading({ label = "페이지를 불러오는 중" }: { readonly label?: string }) {
  return <LoadingIndicator label={label} />;
}

export function LoadError({ error, onRetry }: { readonly error: unknown; readonly onRetry?: () => void }) {
  const apiError = toAdminApiError(error);
  return (
    <Callout tone="error">
      <strong>요청을 완료하지 못했습니다.</strong> {apiError.message}
      {onRetry ? <div><Button variant="quiet" onPress={onRetry}>다시 시도</Button></div> : null}
    </Callout>
  );
}

/**
 * Content Realm의 권한/멤버십 화면은 진입 자체가 권한을 요구한다. Realm을 만든
 * 직후의 운영자는 이 Realm의 정책을 볼 권한도, 멤버십도 없어서 서버가 다음 중
 * 하나로 거부한다 — 부트스트랩 데드락:
 *   - `AUTHORIZATION_DENIED` (getPolicy가 authorization.read를 요구, NO_PERMISSION)
 *   - `REALM_MEMBERSHIP_REQUIRED` (그 Realm의 활성 멤버가 아님)
 *   - realm 목록/상세는 `authorization.manage`를 요구 → 역시 NO_PERMISSION
 * 이 경우 (영어 원문) 일반 오류 대신, 탈출구를 한국어로 안내한다.
 */
export function isRealmBootstrapDenial(error: unknown): boolean {
  const apiError = toAdminApiError(error);
  if (apiError.status !== 403) return false;
  if (apiError.code === "REALM_MEMBERSHIP_REQUIRED") return true;
  if (apiError.code !== "AUTHORIZATION_DENIED") return false;
  const details = apiError.details as { readonly decision?: { readonly reasonCode?: string } } | undefined;
  // getPolicy/manage 거부는 reasonCode NO_PERMISSION으로 나온다. reasonCode가
  // 없더라도 AUTHORIZATION_DENIED(403)면 부트스트랩 안내를 보여주는 편이 안전하다.
  return details?.decision?.reasonCode === undefined
    || details.decision.reasonCode === "NO_PERMISSION";
}

/**
 * Realm 권한/멤버십 화면에서 로드가 실패했을 때, 부트스트랩 데드락이면 탈출
 * 안내를, 아니면 일반 오류를 렌더한다. `context`로 화면 맥락에 맞는 문구/CTA를 고른다.
 */
export function RealmAuthorizationError({ error, onRetry, context, realmId }: {
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly context: "list" | "detail" | "policy";
  readonly realmId?: string;
}) {
  const navigate = useNavigate();
  if (!isRealmBootstrapDenial(error)) return <LoadError error={error} onRetry={onRetry} />;
  // System 워크스페이스(realm 스코프 아님)의 권한 화면은 이 데드락과 무관하다.
  // realmId가 없으면 realm 부트스트랩 안내 대신 일반 오류를 보여준다.
  if (context === "policy" && realmId === undefined) return <LoadError error={error} onRetry={onRetry} />;

  if (context === "list") {
    return (
      <Callout tone="warning">
        <strong>사용자 공간을 관리할 권한이 없습니다.</strong>
        <div>
          사용자 공간 목록을 보고 관리하려면 운영 계정에 <code>authorization.manage</code> 권한이 필요합니다.
          권한이 있는 운영자에게 역할 배정을 요청하세요.
        </div>
        <div><Button variant="quiet" onPress={onRetry}>다시 시도</Button></div>
      </Callout>
    );
  }

  if (context === "detail") {
    return (
      <Callout tone="warning">
        <strong>이 사용자 공간을 관리할 권한이 없습니다.</strong>
        <div>
          사용자 공간 상세를 보려면 운영 계정에 <code>authorization.manage</code> 권한이 필요합니다.
          권한이 있는 운영자에게 역할 배정을 요청하세요.
        </div>
        <div><Button variant="quiet" onPress={() => navigate("/admin/realms")}>사용자 공간 목록으로</Button></div>
      </Callout>
    );
  }

  // context === "policy"
  return (
    <Callout tone="warning">
      <strong>이 사용자 공간의 권한을 관리할 권한이 아직 없습니다.</strong>
      <div>
        사용자 공간을 만든 직후에는 운영자 계정에 이 공간의 권한 정책을 볼 권한이 없습니다.
        사용자 공간의 <strong>“사용자 할당”</strong>에서 본인(또는 담당자)을 <strong>“관리자로 지정”</strong>하면
        이 화면에 들어올 수 있습니다.
      </div>
      <div>
        {realmId !== undefined ? (
          <Button onPress={() => navigate(`/admin/realms/${encodeURIComponent(realmId)}`)}>
            사용자 공간 상세로 이동해 관리자 지정
          </Button>
        ) : null}
        <Button variant="quiet" onPress={onRetry}>다시 시도</Button>
      </div>
    </Callout>
  );
}

export function ConflictNotice({ onReload }: { readonly onReload: () => void }) {
  return (
    <Callout tone="warning">
      <strong>다른 변경이 먼저 저장되었습니다.</strong> 현재 입력을 덮어쓰지 않았습니다. 최신 버전을 불러온 뒤 다시 시도해 주세요.
      <div><Button variant="quiet" onPress={onReload}>최신 버전 불러오기</Button></div>
    </Callout>
  );
}
