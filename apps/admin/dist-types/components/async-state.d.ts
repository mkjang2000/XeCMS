export declare function PageLoading({ label }: {
    readonly label?: string;
}): import("react").JSX.Element;
export declare function LoadError({ error, onRetry }: {
    readonly error: unknown;
    readonly onRetry?: () => void;
}): import("react").JSX.Element;
/**
 * Content Realm의 권한/멤버십 화면은 진입 자체가 권한을 요구한다. Realm을 만든
 * 직후의 운영자는 이 Realm의 정책을 볼 권한도, 멤버십도 없어서 서버가 다음 중
 * 하나로 거부한다 — 부트스트랩 데드락:
 *   - `AUTHORIZATION_DENIED` (getPolicy가 authorization.read를 요구, NO_PERMISSION)
 *   - `REALM_MEMBERSHIP_REQUIRED` (그 Realm의 활성 멤버가 아님)
 *   - realm 목록/상세는 `authorization.manage`를 요구 → 역시 NO_PERMISSION
 * 이 경우 (영어 원문) 일반 오류 대신, 탈출구를 한국어로 안내한다.
 */
export declare function isRealmBootstrapDenial(error: unknown): boolean;
/**
 * Realm 권한/멤버십 화면에서 로드가 실패했을 때, 부트스트랩 데드락이면 탈출
 * 안내를, 아니면 일반 오류를 렌더한다. `context`로 화면 맥락에 맞는 문구/CTA를 고른다.
 */
export declare function RealmAuthorizationError({ error, onRetry, context, realmId }: {
    readonly error: unknown;
    readonly onRetry: () => void;
    readonly context: "list" | "detail" | "policy";
    readonly realmId?: string;
}): import("react").JSX.Element;
export declare function ConflictNotice({ onReload }: {
    readonly onReload: () => void;
}): import("react").JSX.Element;
//# sourceMappingURL=async-state.d.ts.map