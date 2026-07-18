import type {
  AuthorizationLevel,
  AuthorizationPolicy,
  AuthorizationResource,
  AuthorizationRole,
  AuthorizationRoleBinding,
  AuthorizationRoleInput,
} from "@xecms/admin";

/**
 * 간단 모드(등급 관리·멤버)가 권한 정책을 "등급" 관점으로 읽고 쓰기 위한 순수 뷰 모델.
 * 화면에 노출하지 않는 고급 설정(위임, 필드 접근, 제약 조건)은 절대 파괴하지 않는다는
 * 무손실 불변식을 이 모듈에서 보장한다.
 */

export type LevelSimpleState =
  | { readonly kind: "editable"; readonly role: AuthorizationRole }
  | { readonly kind: "empty" }
  | { readonly kind: "protected"; readonly roles: readonly AuthorizationRole[] }
  | { readonly kind: "aggregate"; readonly roles: readonly AuthorizationRole[] };

export type SubjectGradeState =
  | { readonly kind: "none" }
  | {
      readonly kind: "simple";
      readonly levelId: string;
      readonly binding: AuthorizationRoleBinding;
      readonly locked: boolean;
    }
  | { readonly kind: "complex"; readonly reasons: readonly string[] };

/** Full Access(비상 전체 접근) 조회 결과. 기능 미지원과 조회 실패를 구분한다. */
export type FullAccessInfo =
  | { readonly kind: "unsupported" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "loaded"; readonly subjectIds: readonly string[] };

export function rootResource(policy: AuthorizationPolicy): AuthorizationResource | null {
  const roots = policy.resources.filter((resource) => resource.parentId === undefined);
  return roots.length === 1 ? roots[0]! : null;
}

export function rolesOfLevel(policy: AuthorizationPolicy, levelId: string): readonly AuthorizationRole[] {
  return policy.roles.filter((role) => role.levelId === levelId);
}

export function levelSimpleState(policy: AuthorizationPolicy, level: AuthorizationLevel): LevelSimpleState {
  const roles = rolesOfLevel(policy, level.id);
  if (level.protected) return { kind: "protected", roles };
  if (roles.length === 0) return { kind: "empty" };
  const single = roles.length === 1 ? roles[0]! : null;
  if (single !== null) {
    return single.protected ? { kind: "protected", roles } : { kind: "editable", role: single };
  }
  return { kind: "aggregate", roles };
}

/** subject가 직접·간접(그룹 전이)으로 속한 그룹 ID 전체. */
export function ancestorGroupIds(policy: AuthorizationPolicy, subjectId: string): readonly string[] {
  const found = new Set<string>();
  let frontier = [subjectId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const memberId of frontier) {
      for (const edge of policy.groupMemberships) {
        if (edge.memberSubjectId === memberId && !found.has(edge.groupSubjectId)) {
          found.add(edge.groupSubjectId);
          next.push(edge.groupSubjectId);
        }
      }
    }
    frontier = next;
  }
  return [...found];
}

export function subjectGradeState(
  policy: AuthorizationPolicy,
  subjectId: string,
  fullAccess: FullAccessInfo,
): SubjectGradeState {
  const reasons: string[] = [];
  const direct = policy.bindings.filter((binding) => binding.subjectId === subjectId);

  if (fullAccess.kind === "unavailable") {
    reasons.push("권한 정보를 모두 확인할 수 없어요.");
  } else if (fullAccess.kind === "loaded" && fullAccess.subjectIds.includes(subjectId)) {
    reasons.push("전체 접근(Full Access) 권한이 함께 부여되어 있어요.");
  }

  const groups = ancestorGroupIds(policy, subjectId);
  if (groups.length > 0 && policy.bindings.some((binding) => groups.includes(binding.subjectId))) {
    reasons.push("그룹을 통해 권한을 받고 있어요.");
  }

  if (direct.length > 1) reasons.push("역할이 여러 개 배정되어 있어요.");

  if (direct.length === 0) {
    return reasons.length > 0 ? { kind: "complex", reasons } : { kind: "none" };
  }

  const binding = direct[0]!;
  if (direct.length === 1) {
    const root = rootResource(policy);
    if (root === null) {
      reasons.push("관리 영역 구조를 확인할 수 없어요.");
    } else if (binding.resourceId !== root.id || binding.propagation !== "self-and-children") {
      reasons.push("특정 영역에만 적용되는 권한이 있어요.");
    }
    if (binding.validFrom !== undefined || binding.validUntil !== undefined) {
      reasons.push("기간 조건이 설정되어 있어요.");
    }
    if (binding.constraints !== undefined) {
      reasons.push("소유자·상태 조건이 설정되어 있어요.");
    }
    const role = policy.roles.find(({ id }) => id === binding.roleId);
    const level = role === undefined
      ? undefined
      : policy.levels.find(({ id }) => id === role.levelId);
    if (role === undefined || level === undefined) {
      reasons.push("배정된 역할 정보를 확인할 수 없어요.");
    } else {
      const state = levelSimpleState(policy, level);
      if (state.kind === "aggregate" || (state.kind === "editable" && state.role.id !== role.id)) {
        reasons.push("등급이 여러 역할로 나뉘어 있어요.");
      }
    }
    if (reasons.length > 0) return { kind: "complex", reasons };
    const subject = policy.subjects.find(({ id }) => id === subjectId);
    return {
      kind: "simple",
      levelId: level!.id,
      binding,
      locked: binding.protected || subject?.protected === true || level!.protected,
    };
  }
  return { kind: "complex", reasons };
}

/**
 * 등급 권한 시트 저장 → updateRole 입력.
 * 화면에 없는 description/fieldAccess는 원본 그대로, delegatablePermissions는
 * 계속 허용되는 권한에 한해 그대로 유지한다(권한 해제 시에만 함께 해제).
 */
export function gradePermissionEdit(
  role: AuthorizationRole,
  nextPermissions: readonly string[],
): AuthorizationRoleInput {
  return {
    name: role.name,
    description: role.description,
    levelId: role.levelId,
    permissions: nextPermissions,
    delegatablePermissions: role.delegatablePermissions.filter((key) => nextPermissions.includes(key)),
    fieldAccess: role.fieldAccess,
  };
}

/** 권한 해제로 함께 사라지는 위임 설정 목록(확인 대화상자 안내용). */
export function droppedDelegations(
  role: AuthorizationRole,
  nextPermissions: readonly string[],
): readonly string[] {
  return role.delegatablePermissions.filter((key) => !nextPermissions.includes(key));
}

/**
 * 두 이웃 등급 사이에 넣을 수 있는 rank. 정수 틈이 없으면 null(가드레일 대상).
 * upperRank가 null이면 최상위 위, lowerRank가 null이면 최하위 아래 삽입.
 */
export function rankBetween(upperRank: number | null, lowerRank: number | null): number | null {
  if (upperRank === null && lowerRank === null) return 50;
  if (upperRank === null) return lowerRank! + 10;
  if (lowerRank === null) {
    const candidate = Math.floor(upperRank / 2);
    return candidate >= 0 && candidate < upperRank ? candidate : null;
  }
  const candidate = Math.floor((upperRank + lowerRank) / 2);
  return candidate > lowerRank && candidate < upperRank ? candidate : null;
}

/** rank 내림차순 등급 목록(등급 카드·삽입 위치 계산의 기준 정렬). */
export function sortedLevels(policy: AuthorizationPolicy): readonly AuthorizationLevel[] {
  return [...policy.levels].sort((left, right) => right.rank - left.rank);
}

/** 등급별 직접 배정 멤버 수(등급 카드 요약용). */
export function memberCountByLevel(policy: AuthorizationPolicy): ReadonlyMap<string, number> {
  const levelByRole = new Map(policy.roles.map((role) => [role.id, role.levelId]));
  const subjectsByLevel = new Map<string, Set<string>>();
  for (const binding of policy.bindings) {
    const levelId = levelByRole.get(binding.roleId);
    if (levelId === undefined) continue;
    const set = subjectsByLevel.get(levelId) ?? new Set<string>();
    set.add(binding.subjectId);
    subjectsByLevel.set(levelId, set);
  }
  return new Map([...subjectsByLevel.entries()].map(([levelId, set]) => [levelId, set.size]));
}

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
export function gradeOptions(policy: AuthorizationPolicy): readonly GradeOption[] {
  return sortedLevels(policy).flatMap((level): readonly GradeOption[] => {
    const state = levelSimpleState(policy, level);
    if (state.kind === "protected") return [];
    if (state.kind === "editable") {
      return [{ levelId: level.id, levelName: level.name, roleId: state.role.id, disabledReason: null }];
    }
    if (state.kind === "empty") {
      return [{ levelId: level.id, levelName: level.name, roleId: null, disabledReason: "등급의 권한을 먼저 정해 주세요" }];
    }
    return [{ levelId: level.id, levelName: level.name, roleId: null, disabledReason: "표준 모드에서 지정" }];
  });
}
