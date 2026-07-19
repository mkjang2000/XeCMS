import type { AuthorizationPolicy, AuthorizationRoleBinding } from "@xecms/admin";

export const permissionCategoryNames: Readonly<Record<string, string>> = {
  authorization: "권한 정책",
  content: "콘텐츠",
  schema: "스키마",
  identity: "사용자",
  "service-account": "서비스 계정",
  group: "그룹",
  role: "역할",
  "authority-level": "권한 레벨",
  media: "미디어",
  plugin: "플러그인",
  job: "백그라운드 작업",
  audit: "감사 로그",
  retention: "데이터 보존",
  "api-key": "API 키",
  system: "시스템 설정",
  site: "사이트",
  "admin-app": "Admin App",
};

export const permissionObjectNames: Readonly<Record<string, string>> = {
  authorization: "권한 정책",
  content: "콘텐츠",
  revision: "버전",
  schema: "스키마",
  identity: "사용자",
  credentials: "인증 정보",
  session: "세션",
  owner: "소유자",
  "system-membership": "시스템 계정 연결",
  "service-account": "서비스 계정",
  group: "그룹",
  member: "구성원",
  role: "역할",
  "authority-level": "권한 레벨",
  media: "미디어",
  plugin: "플러그인",
  job: "백그라운드 작업",
  audit: "감사 로그",
  retention: "데이터 보존 정책",
  consistency: "무결성 검사",
  "api-key": "API 키",
  system: "시스템",
  settings: "설정",
  site: "사이트",
  collection: "컬렉션",
  "admin-app": "Admin App",
};

export const permissionVerbNames: Readonly<Record<string, string>> = {
  list: "목록 보기",
  read: "보기",
  create: "만들기",
  update: "수정",
  delete: "삭제",
  purge: "영구 삭제",
  publish: "게시",
  unpublish: "게시 취소",
  archive: "보관",
  restore: "복원",
  reset: "재설정",
  revoke: "폐기",
  transfer: "이전",
  install: "설치",
  configure: "설정",
  enable: "활성화",
  disable: "비활성화",
  uninstall: "제거",
  retry: "재시도",
  export: "내보내기",
  preview: "미리보기",
  apply: "적용",
  upload: "업로드",
  bind: "연결",
  assign: "배정",
  reorder: "순서 변경",
  manage: "관리",
  access: "접근",
};

export function permissionCategoryName(category: string): string {
  return permissionCategoryNames[category] ?? category;
}

export function permissionTaskName(key: string): string {
  const parts = key.split(".");
  const operation = parts.pop() ?? key;
  const object = parts.map((part) => permissionObjectNames[part] ?? part).join(" · ");
  return `${object} ${permissionVerbNames[operation] ?? operation}`;
}

export function subjectTypeName(type: AuthorizationPolicy["subjects"][number]["type"]): string {
  switch (type) {
    case "user": return "사용자";
    case "group": return "그룹";
    case "service-account": return "서비스 계정";
  }
}

export function propagationLabel(propagation: AuthorizationRoleBinding["propagation"]): string {
  switch (propagation) {
    case "self": return "현재 리소스";
    case "children": return "하위만 (현재 제외)";
    case "self-and-children": return "현재 + 모든 하위";
  }
}

export function hierarchyContextDescription(
  guard: AuthorizationPolicy["permissions"][number]["hierarchyGuard"],
): string {
  switch (guard) {
    case "target-role": return "대상 역할의 Authority Level context가 필요합니다.";
    case "target-binding": return "대상 바인딩의 역할·주체·Scope context가 필요합니다.";
    case "target-subject": return "대상 사용자의 Authority Level과 보호 상태 context가 필요합니다.";
    case "none": return "";
  }
}

export function decisionReasonName(code: string): string {
  const names: Readonly<Record<string, string>> = {
    PERMISSION_GRANTED: "필요한 역할과 권한이 적용되어 있습니다.",
    ALLOW_PERMISSION: "필요한 역할과 권한이 적용되어 있습니다.",
    ALLOW_REALM_FULL_ACCESS: "이 Realm의 전체 접근 권한이 적용되어 있습니다.",
    PERMISSION_NOT_GRANTED: "이 업무를 허용하는 역할이 배정되지 않았습니다.",
    DENY_PERMISSION: "이 업무를 허용하는 역할이 배정되지 않았습니다.",
    CONSTRAINT_NOT_SATISFIED: "배정된 역할의 기간·소유자·상태 조건과 일치하지 않습니다.",
    RESOURCE_NOT_IN_SCOPE: "역할이 적용되는 영역 밖에 있습니다.",
    SUBJECT_DISABLED: "사용자 또는 그룹이 비활성화되어 있습니다.",
    HIERARCHY_CONTEXT_REQUIRED: "대상과의 권한 레벨 정보가 더 필요합니다.",
    DENY_ENTITLEMENT_GATE: "CMS에서 이 콘텐츠에 대한 공간의 접근 범위를 허용하지 않았습니다. 공간 안 권한과 무관하게 상위 상한에서 차단됩니다.",
    ENTITLEMENT_RESOURCE_UNRESOLVED: "이 콘텐츠를 접근 상한이 적용되는 콘텐츠 유형으로 확인할 수 없어 차단되었습니다.",
  };
  return names[code] ?? "현재 정책 조건에 따라 판정되었습니다.";
}
