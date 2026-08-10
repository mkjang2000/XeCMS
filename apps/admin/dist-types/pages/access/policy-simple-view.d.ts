import type { AuthorizationLevel, AuthorizationPolicy, AuthorizationResource, AuthorizationRole, AuthorizationRoleBinding, AuthorizationRoleInput } from "@xecms/admin";
/**
 * 간단 모드(등급 관리·멤버)가 권한 정책을 "등급" 관점으로 읽고 쓰기 위한 순수 뷰 모델.
 * 화면에 노출하지 않는 고급 설정(위임, 필드 접근, 제약 조건)은 절대 파괴하지 않는다는
 * 무손실 불변식을 이 모듈에서 보장한다.
 */
export type LevelSimpleState = {
    readonly kind: "editable";
    readonly role: AuthorizationRole;
} | {
    readonly kind: "empty";
} | {
    readonly kind: "protected";
    readonly roles: readonly AuthorizationRole[];
} | {
    readonly kind: "aggregate";
    readonly roles: readonly AuthorizationRole[];
};
export type SubjectGradeState = {
    readonly kind: "none";
} | {
    readonly kind: "simple";
    readonly levelId: string;
    readonly binding: AuthorizationRoleBinding;
    readonly locked: boolean;
} | {
    readonly kind: "complex";
    readonly reasons: readonly string[];
};
export declare function rootResource(policy: AuthorizationPolicy): AuthorizationResource | null;
export declare function rolesOfLevel(policy: AuthorizationPolicy, levelId: string): readonly AuthorizationRole[];
export declare function levelSimpleState(policy: AuthorizationPolicy, level: AuthorizationLevel): LevelSimpleState;
/** subject가 직접·간접(그룹 전이)으로 속한 그룹 ID 전체. */
export declare function ancestorGroupIds(policy: AuthorizationPolicy, subjectId: string): readonly string[];
export declare function subjectGradeState(policy: AuthorizationPolicy, subjectId: string): SubjectGradeState;
/**
 * 등급 권한 시트 저장 → updateRole 입력.
 * 화면에 없는 description/fieldAccess는 원본 그대로, delegatablePermissions는
 * 계속 허용되는 권한에 한해 그대로 유지한다(권한 해제 시에만 함께 해제).
 */
export declare function gradePermissionEdit(role: AuthorizationRole, nextPermissions: readonly string[]): AuthorizationRoleInput;
/** 권한 해제로 함께 사라지는 위임 설정 목록(확인 대화상자 안내용). */
export declare function droppedDelegations(role: AuthorizationRole, nextPermissions: readonly string[]): readonly string[];
/**
 * 두 이웃 등급 사이에 넣을 수 있는 rank. 정수 틈이 없으면 null(가드레일 대상).
 * upperRank가 null이면 최상위 위, lowerRank가 null이면 최하위 아래 삽입.
 */
export declare function rankBetween(upperRank: number | null, lowerRank: number | null): number | null;
/** rank 내림차순 등급 목록(등급 카드·삽입 위치 계산의 기준 정렬). */
export declare function sortedLevels(policy: AuthorizationPolicy): readonly AuthorizationLevel[];
/** 등급별 직접 배정 멤버 수(등급 카드 요약용). */
export declare function memberCountByLevel(policy: AuthorizationPolicy): ReadonlyMap<string, number>;
export interface GradeOption {
    readonly levelId: string;
    readonly levelName: string;
    readonly roleId: string | null;
    readonly disabledReason: string | null;
}
/**
 * 멤버 화면의 등급 선택지. protected 등급(Owner/Public)은 제외하고,
 * aggregate 등급은 비활성 사유와 함께 노출한다.
 */
export declare function gradeOptions(policy: AuthorizationPolicy): readonly GradeOption[];
//# sourceMappingURL=policy-simple-view.d.ts.map