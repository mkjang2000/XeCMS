import { type IdentityRealm, type RealmMembership, type RealmOwnerStatus } from "@xecms/admin";
import { Button, Callout } from "@xecms/ui";
import { Checklist, type StepDef } from "../../components/stepper.js";
import { isRealmSetupIncomplete, realmSetupSteps, type RealmSetupStepId } from "../realm-setup.js";

const STEP_LABEL: Record<RealmSetupStepId, string> = {
  activate: "1. 스키마 연결 · 활성화",
  owner: "2. 소유자 지정",
  administrator: "3. 관리자 지정",
  access: "4. 권한 구성",
};

/**
 * Setup progress for a Content Realm, derived entirely from already-loaded
 * queries. Turns the hidden ordering (activate → owner → administrator →
 * access) into a visible checklist and — crucially — previews the bootstrap
 * deadlock before the operator is bounced out of the policy screen.
 */
export function RealmSetupChecklist({
  realm, owner, memberships, ownerCandidateCount, onOpenProfileSetup, onGoMembers, onGoAccess,
}: {
  readonly realm: IdentityRealm;
  readonly owner: RealmOwnerStatus | undefined;
  readonly memberships: readonly RealmMembership[] | undefined;
  readonly ownerCandidateCount: number;
  readonly onOpenProfileSetup: () => void;
  readonly onGoMembers: () => void;
  readonly onGoAccess: () => void;
}) {
  const steps = realmSetupSteps({ realm, owner, memberships, ownerCandidateCount });
  if (!isRealmSetupIncomplete(steps)) return null;
  const byId = new Map(steps.map((step) => [step.id, step.status]));

  const stepDefs: StepDef[] = steps.map((step): StepDef => {
    const base = { id: step.id, label: STEP_LABEL[step.id], status: step.status };
    if (step.id === "activate" && step.status !== "done") {
      return {
        ...base,
        description: "로그인 identifier와 기본 Profile 필드를 정하면 Collection 생성·연결·활성화를 한 번에 처리합니다.",
        action: <Button size="small" onPress={onOpenProfileSetup}>기본 인증 스키마 생성</Button>,
      };
    }
    if (step.id === "owner" && step.status === "blocked") {
      return {
        ...base,
        description: "소유자로 지정할 활성 사용자가 아직 없습니다. ‘사용자’ 탭에서 새 사용자를 만들거나 기존 운영자를 연결하세요.",
        action: <Button size="small" variant="secondary" onPress={onGoMembers}>사용자 탭으로 이동</Button>,
      };
    }
    if (step.id === "owner" && step.status === "current") {
      return {
        ...base,
        description: "이 공간의 사람 최고관리자를 지정해 운영 연속성을 확보하세요.",
        action: <Button size="small" onPress={onGoMembers}>소유자 지정하러 가기</Button>,
      };
    }
    if (step.id === "administrator" && step.status === "current") {
      return {
        ...base,
        description: "공간을 활성화해도 만든 본인은 권한 화면에 들어갈 수 없습니다. ‘사용자’ 탭에서 본인(또는 담당자)을 관리자로 지정하세요.",
        action: <Button size="small" onPress={onGoMembers}>관리자 지정하러 가기</Button>,
      };
    }
    if (step.id === "access" && step.status === "current") {
      return {
        ...base,
        description: "이제 권한 등급·역할·배정을 구성할 수 있습니다.",
        action: <Button size="small" variant="secondary" onPress={onGoAccess}>권한 구성으로 이동</Button>,
      };
    }
    return base;
  });

  const tone = byId.get("owner") === "blocked" ? "warning" : "info";
  return (
    <Callout tone={tone}>
      <Checklist title="설정 진행 상태" steps={stepDefs} />
    </Callout>
  );
}
