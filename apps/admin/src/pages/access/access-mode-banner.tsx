import type { AuthorizationPolicy } from "@xecms/admin";
import { Badge, Button, Callout } from "@xecms/ui";
import { useNavigate } from "react-router";
import styles from "../../authorization.module.css";
import { authorizationAccessMode } from "./workspace.js";

function remainingLabel(validUntil?: string): string | null {
  if (validUntil === undefined) return null;
  const minutes = Math.max(0, Math.ceil((Date.parse(validUntil) - Date.now()) / 60_000));
  if (minutes < 60) return `${minutes}분 후 만료`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}시간 후 만료` : `${hours}시간 ${rest}분 후 만료`;
}

export function AccessModeBanner({ policy, realmId }: {
  readonly policy: AuthorizationPolicy;
  readonly realmId?: string;
}) {
  const navigate = useNavigate();
  if (realmId === undefined) return null;
  const mode = authorizationAccessMode(policy, realmId);
  const openFullAccess = () => navigate(`/admin/realms/${encodeURIComponent(realmId)}?tab=access`);
  if (mode === "cms-owner-readonly") {
    return (
      <Callout tone="info">
        <strong>CMS Owner 읽기 전용 보기</strong>
        <div>Realm 운영 상태를 감독하고 있습니다. 정책을 직접 변경하려면 기간 제한 Full Access가 필요합니다.</div>
        <div><Button variant="danger" onPress={openFullAccess}>Full Access 시작</Button></div>
      </Callout>
    );
  }
  if (mode === "realm-full-access") {
    return (
      <div className={styles.fullAccessModeBanner} role="status">
        <div><Badge tone="danger">Full Access 사용 중</Badge><strong>{remainingLabel(policy.administration?.fullAccessValidUntil) ?? "기간 제한 접근"}</strong></div>
        <span>CMS Owner 비상 관리 모드입니다. 모든 정책 변경이 별도 감사 이벤트로 기록됩니다.</span>
        <Button size="small" variant="danger" onPress={openFullAccess}>상태·해제</Button>
      </div>
    );
  }
  return null;
}
