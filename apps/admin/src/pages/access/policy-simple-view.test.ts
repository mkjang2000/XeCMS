import { describe, expect, it } from "vitest";
import {
  ancestorGroupIds,
  droppedDelegations,
  gradeOptions,
  gradePermissionEdit,
  levelSimpleState,
  memberCountByLevel,
  rankBetween,
  rootResource,
  subjectGradeState,
} from "./policy-simple-view.js";
import { seedPolicy } from "./test-fixtures.js";

const loadedFullAccess = { kind: "loaded", subjectIds: [] } as const;

describe("rootResource", () => {
  it("finds the unique root and falls back to null when ambiguous", () => {
    const policy = seedPolicy();
    expect(rootResource(policy)?.id).toBe("root");
    const orphan = seedPolicy({
      resources: [...policy.resources, { id: "orphan", realmId: "system", type: "workspace", name: "Orphan", protected: false }],
    });
    expect(rootResource(orphan)).toBeNull();
  });
});

describe("levelSimpleState", () => {
  it("classifies the seed ladder: protected / aggregate / editable / empty", () => {
    const policy = seedPolicy();
    const level = (id: string) => policy.levels.find((item) => item.id === id)!;
    expect(levelSimpleState(policy, level("level-owner")).kind).toBe("protected");
    expect(levelSimpleState(policy, level("level-public")).kind).toBe("protected");
    // 기본 시드의 Administrators 2-role 케이스는 aggregate가 정상 상태다.
    const admin = levelSimpleState(policy, level("level-admin"));
    expect(admin.kind).toBe("aggregate");
    expect(admin.kind === "aggregate" && admin.roles.map(({ id }) => id)).toEqual(["role-content-admin", "role-security-admin"]);
    const editor = levelSimpleState(policy, level("level-editor"));
    expect(editor.kind === "editable" && editor.role.id).toBe("role-editor");
    const empty = seedPolicy({ roles: policy.roles.filter(({ id }) => id !== "role-viewer") });
    expect(levelSimpleState(empty, level("level-viewer")).kind).toBe("empty");
  });

  it("treats a single protected role in a normal level as protected", () => {
    const policy = seedPolicy();
    const withProtectedRole = seedPolicy({
      roles: policy.roles.map((role) => role.id === "role-viewer" ? { ...role, protected: true } : role),
    });
    expect(levelSimpleState(withProtectedRole, policy.levels.find(({ id }) => id === "level-viewer")!).kind).toBe("protected");
  });
});

describe("subjectGradeState", () => {
  it("is simple for one root-wide unconstrained binding to an editable level", () => {
    const state = subjectGradeState(seedPolicy(), "subject-editor", loadedFullAccess);
    expect(state.kind).toBe("simple");
    expect(state.kind === "simple" && state.levelId).toBe("level-editor");
    expect(state.kind === "simple" && state.locked).toBe(false);
  });

  it("locks protected owners instead of hiding them", () => {
    const state = subjectGradeState(seedPolicy(), "subject-owner", loadedFullAccess);
    expect(state.kind).toBe("simple");
    expect(state.kind === "simple" && state.locked).toBe(true);
  });

  it("is none for a subject without bindings", () => {
    expect(subjectGradeState(seedPolicy(), "subject-new", loadedFullAccess).kind).toBe("none");
  });

  it("flags group-inherited roles (transitively) as complex", () => {
    expect(ancestorGroupIds(seedPolicy(), "subject-grouped")).toEqual(["group-writers", "group-parent"]);
    const state = subjectGradeState(seedPolicy(), "subject-grouped", loadedFullAccess);
    expect(state.kind).toBe("complex");
    expect(state.kind === "complex" && state.reasons).toContain("그룹을 통해 권한을 받고 있어요.");
  });

  it("flags scoped, constrained, or timed bindings as complex", () => {
    const policy = seedPolicy();
    const scoped = seedPolicy({
      bindings: policy.bindings.map((item) =>
        item.id === "binding-editor" ? { ...item, resourceId: "content", propagation: "self" as const } : item),
    });
    const scopedState = subjectGradeState(scoped, "subject-editor", loadedFullAccess);
    expect(scopedState.kind === "complex" && scopedState.reasons).toContain("특정 영역에만 적용되는 권한이 있어요.");

    const timed = seedPolicy({
      bindings: policy.bindings.map((item) =>
        item.id === "binding-editor" ? { ...item, validUntil: "2026-12-31T00:00:00.000Z" } : item),
    });
    const timedState = subjectGradeState(timed, "subject-editor", loadedFullAccess);
    expect(timedState.kind === "complex" && timedState.reasons).toContain("기간 조건이 설정되어 있어요.");

    const constrained = seedPolicy({
      bindings: policy.bindings.map((item) =>
        item.id === "binding-editor" ? { ...item, constraints: { statuses: ["draft"] } } : item),
    });
    const constrainedState = subjectGradeState(constrained, "subject-editor", loadedFullAccess);
    expect(constrainedState.kind === "complex" && constrainedState.reasons).toContain("소유자·상태 조건이 설정되어 있어요.");

    const multi = seedPolicy({
      bindings: [...policy.bindings, { id: "binding-extra", realmId: "system", subjectId: "subject-editor", roleId: "role-viewer", resourceId: "root", propagation: "self-and-children" as const, protected: false }],
    });
    const multiState = subjectGradeState(multi, "subject-editor", loadedFullAccess);
    expect(multiState.kind === "complex" && multiState.reasons).toContain("역할이 여러 개 배정되어 있어요.");
  });

  it("distinguishes Full Access lookup failure (complex) from unsupported (ignored)", () => {
    const unavailable = subjectGradeState(seedPolicy(), "subject-editor", { kind: "unavailable" });
    expect(unavailable.kind).toBe("complex");
    expect(unavailable.kind === "complex" && unavailable.reasons).toContain("권한 정보를 모두 확인할 수 없어요.");

    expect(subjectGradeState(seedPolicy(), "subject-editor", { kind: "unsupported" }).kind).toBe("simple");

    const granted = subjectGradeState(seedPolicy(), "subject-editor", { kind: "loaded", subjectIds: ["subject-editor"] });
    expect(granted.kind === "complex" && granted.reasons).toContain("전체 접근(Full Access) 권한이 함께 부여되어 있어요.");
  });
});

describe("gradePermissionEdit (무손실 불변식)", () => {
  const editorRole = seedPolicy().roles.find(({ id }) => id === "role-editor")!;

  it("passes hidden delegations, fieldAccess and description through verbatim", () => {
    const input = gradePermissionEdit(editorRole, ["content.read", "content.update", "content.publish"]);
    expect(input).toEqual({
      name: "Editors",
      description: "콘텐츠 담당",
      levelId: "level-editor",
      permissions: ["content.read", "content.update", "content.publish"],
      delegatablePermissions: ["content.update", "content.publish"],
      fieldAccess: [{ resourceId: "content", readableFields: ["title"], writableFields: [] }],
    });
  });

  it("drops a delegation only when its permission is turned off, and reports it", () => {
    const next = ["content.read", "content.update"];
    const input = gradePermissionEdit(editorRole, next);
    expect(input.delegatablePermissions).toEqual(["content.update"]);
    expect(droppedDelegations(editorRole, next)).toEqual(["content.publish"]);
    expect(droppedDelegations(editorRole, ["content.read", "content.update", "content.publish"])).toEqual([]);
  });
});

describe("rankBetween", () => {
  it("returns the integer midpoint only when a gap exists", () => {
    expect(rankBetween(80, 40)).toBe(60);
    expect(rankBetween(41, 40)).toBeNull();
    expect(rankBetween(42, 40)).toBe(41);
    expect(rankBetween(null, 100)).toBe(110);
    expect(rankBetween(10, null)).toBe(5);
    expect(rankBetween(1, null)).toBe(0);
    expect(rankBetween(0, null)).toBeNull();
    expect(rankBetween(null, null)).toBe(50);
  });
});

describe("gradeOptions / memberCountByLevel", () => {
  it("excludes protected grades and disables aggregate grades", () => {
    const options = gradeOptions(seedPolicy());
    expect(options.map(({ levelId }) => levelId)).toEqual(["level-admin", "level-editor", "level-viewer"]);
    expect(options[0]).toMatchObject({ roleId: null, disabledReason: "표준 모드에서 지정" });
    expect(options[1]).toMatchObject({ roleId: "role-editor", disabledReason: null });
  });

  it("counts distinct directly-bound subjects per level", () => {
    const counts = memberCountByLevel(seedPolicy());
    expect(counts.get("level-editor")).toBe(1);
    expect(counts.get("level-owner")).toBe(1);
    expect(counts.get("level-viewer")).toBe(1);
    expect(counts.get("level-admin")).toBeUndefined();
  });
});
