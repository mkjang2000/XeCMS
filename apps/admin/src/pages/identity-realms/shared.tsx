import { useQuery } from "@tanstack/react-query";
import { toAdminApiError, type IdentityRealm, type PageResult, type RealmMembershipStatus, type RealmOwnerStatus } from "@xecms/admin";
import { Badge, Callout } from "@xecms/ui";
import styles from "../../identity-realms.module.css";

export const provisioningOptions = [
  { value: "explicit", label: "명시적 승인" },
  { value: "jit", label: "첫 로그인 시 JIT" },
] as const;

export const registrationOptions = [
  { value: "closed", label: "가입 닫힘" },
  { value: "open", label: "가입 허용" },
] as const;

export function commaValues(value: string): readonly string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

export function RealmStatusBadge({ realm }: { readonly realm: IdentityRealm }) {
  if (realm.kind === "system") return <Badge tone="info">System</Badge>;
  switch (realm.status) {
    case "active": return <Badge tone="success">활성</Badge>;
    case "provisioning": return <Badge tone="warning">프로비저닝 중</Badge>;
    case "disabled": return <Badge tone="danger">비활성</Badge>;
  }
}

export function MembershipStatusBadge({ status }: { readonly status: RealmMembershipStatus }) {
  switch (status) {
    case "active": return <Badge tone="success">활성</Badge>;
    case "pending": return <Badge tone="warning">프로비저닝 중</Badge>;
    case "suspended": return <Badge tone="danger">정지</Badge>;
  }
}

export function MutationError({ error }: { readonly error: unknown }) {
  if (error === null || error === undefined) return null;
  const converted = toAdminApiError(error);
  return <Callout tone="error"><strong>{converted.message}</strong> <span className={styles.errorCode}>{converted.code}</span></Callout>;
}

export type QueryResult<T> = ReturnType<typeof useQuery<PageResult<T>>>;

export type OwnerQueryResult = ReturnType<typeof useQuery<RealmOwnerStatus>>;

export function IdValue({ label, value }: { readonly label: string; readonly value: string }) {
  return <span className={styles.idValue}><span>{label}</span><code>{value}</code></span>;
}
