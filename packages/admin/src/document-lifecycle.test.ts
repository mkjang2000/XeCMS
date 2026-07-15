import { describe, expect, it } from "vitest";
import {
  documentDisplayStateLabel,
  documentPublishActionLabel,
  documentRevisionOriginLabel,
} from "./document-lifecycle.js";

describe("document lifecycle presentation", () => {
  it("maps every display state to a concise Korean label", () => {
    expect(documentDisplayStateLabel("draft")).toBe("초안");
    expect(documentDisplayStateLabel("published")).toBe("게시됨");
    expect(documentDisplayStateLabel("published-with-draft")).toBe("게시됨 · 게시되지 않은 변경");
    expect(documentDisplayStateLabel("archived")).toBe("보관됨");
    expect(documentDisplayStateLabel("deleted")).toBe("삭제됨");
  });

  it("offers publishing only when a draft is available", () => {
    expect(documentPublishActionLabel("draft")).toBe("게시");
    expect(documentPublishActionLabel("published-with-draft")).toBe("변경 사항 게시");
    expect(documentPublishActionLabel("published")).toBeNull();
    expect(documentPublishActionLabel("deleted")).toBeNull();
  });

  it("describes restored revisions without hiding their origin", () => {
    expect(documentRevisionOriginLabel({ kind: "create" })).toBe("생성");
    expect(documentRevisionOriginLabel({ kind: "edit" })).toBe("편집");
    expect(documentRevisionOriginLabel({ kind: "restore", restoredFromRevisionId: "rev-1" }))
      .toBe("버전 복원");
  });
});
