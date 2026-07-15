import type { DocumentDisplayState, DocumentRevisionOrigin } from "./api.js";

const displayStateLabels: Readonly<Record<DocumentDisplayState, string>> = {
  draft: "초안",
  published: "게시됨",
  "published-with-draft": "게시됨 · 게시되지 않은 변경",
  archived: "보관됨",
  deleted: "삭제됨",
};

export function documentDisplayStateLabel(state: DocumentDisplayState): string {
  return displayStateLabels[state];
}

export function documentPublishActionLabel(state: DocumentDisplayState): string | null {
  if (state === "draft") return "게시";
  if (state === "published-with-draft") return "변경 사항 게시";
  return null;
}

export function documentRevisionOriginLabel(origin: DocumentRevisionOrigin): string {
  switch (origin.kind) {
    case "create": return "생성";
    case "edit": return "편집";
    case "restore": return "버전 복원";
  }
}
