import { type CollectionEntitlementAction, type RealmCollectionEntitlement, type RealmCollectionEntitlementList } from "@xecms/admin";

/**
 * UI grouping of the 11 canonical content actions. The model keeps them
 * separate (no information loss); the operator toggles them in meaningful
 * bundles. Each group maps to a set of `CollectionAction`s that are granted or
 * removed together.
 */
export const ENTITLEMENT_ACTION_GROUPS: readonly {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly actions: readonly CollectionEntitlementAction[];
  readonly advanced?: boolean;
}[] = [
  { id: "read", label: "조회", hint: "목록·상세 보기", actions: ["list", "read"] },
  { id: "create", label: "작성", hint: "새 문서 생성", actions: ["create"] },
  { id: "update", label: "수정", hint: "기존 문서 편집", actions: ["update"] },
  { id: "delete", label: "삭제", hint: "문서 삭제", actions: ["delete"] },
  { id: "publish", label: "발행", hint: "발행·발행 취소", actions: ["publish", "unpublish"] },
  {
    id: "lifecycle",
    label: "생명주기",
    hint: "영구 삭제·복원·리비전",
    actions: ["purge", "restore", "revision.read", "revision.restore"],
    advanced: true,
  },
];

export function entitlementActionSummary(actions: readonly CollectionEntitlementAction[]): string {
  const set = new Set(actions);
  const labels = ENTITLEMENT_ACTION_GROUPS
    .filter((group) => group.actions.some((action) => set.has(action)))
    .map((group) => group.label);
  return labels.length === 0 ? "없음" : labels.join(" · ");
}

export function entitlementConstraintSummary(entitlement: RealmCollectionEntitlement): string {
  const parts: string[] = [];
  if (entitlement.constraint?.ownerOnly === true) parts.push("본인 소유만");
  if (entitlement.constraint?.statuses && entitlement.constraint.statuses.length > 0) {
    parts.push(`상태: ${entitlement.constraint.statuses.join(", ")}`);
  }
  return parts.length === 0 ? "제한 없음" : parts.join(" · ");
}

export function entitlementFieldSummary(entitlement: RealmCollectionEntitlement): string {
  const read = entitlement.readableFields;
  const write = entitlement.writableFields;
  if (read === undefined && write === undefined) return "전체";
  const readText = read === undefined ? "전체" : `${read.length}개`;
  const writeText = write === undefined ? "전체" : `${write.length}개`;
  return `읽기 ${readText} · 쓰기 ${writeText}`;
}

/** Optimistically merge a saved entitlement into the cached realm list. */
export function mergeEntitlement(
  previous: RealmCollectionEntitlementList | undefined,
  saved: RealmCollectionEntitlement,
): RealmCollectionEntitlementList {
  if (previous === undefined) return { status: null, entitlements: [saved] };
  const others = previous.entitlements.filter((e) => e.collectionId !== saved.collectionId);
  return { ...previous, entitlements: [...others, saved] };
}
