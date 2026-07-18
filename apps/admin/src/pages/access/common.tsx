import { toAdminApiError, type AuthorizationPolicy, type AuthorizationRoleBinding } from "@xecms/admin";
import { Callout } from "@xecms/ui";
import styles from "../../authorization.module.css";
import { resourcePath } from "../../components/resource-scope-tree.js";

export function PolicySummary({ policy }: { readonly policy: AuthorizationPolicy }) {
  const items = [
    ["정책 Revision", policy.revision],
    ["사용자·그룹", policy.subjects.length],
    ["역할", policy.roles.length],
    ["역할 배정", policy.bindings.length],
  ] as const;
  return (
    <div className={styles.summaryGrid}>
      {items.map(([label, value]) => (
        <div className={styles.summaryCard} key={label}><span>{label}</span><strong>{value}</strong></div>
      ))}
    </div>
  );
}

export function MutationError({ error }: { readonly error: unknown }) {
  if (error === null || error === undefined) return null;
  const converted = toAdminApiError(error);
  const details = converted.details as { readonly decision?: { readonly reasonCode?: string } } | undefined;
  return (
    <Callout tone="error">
      <strong>{converted.message}</strong>
      {details?.decision?.reasonCode ? <div>판정 코드: {details.decision.reasonCode}</div> : null}
    </Callout>
  );
}

export function textList(value: string): readonly string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

export function dateTimeValue(value?: string): string {
  return value === undefined ? "" : new Date(value).toISOString().slice(0, 16);
}

export function optionalInstant(value: string): string | undefined {
  return value === "" ? undefined : new Date(value).toISOString();
}

export function subjectNameOf(policy: AuthorizationPolicy, id: string): string {
  return policy.subjects.find((subject) => subject.id === id)?.name ?? id;
}

export function roleNameOf(policy: AuthorizationPolicy, id: string): string {
  return policy.roles.find((role) => role.id === id)?.name ?? id;
}

export function resourceNameOf(policy: AuthorizationPolicy, id: string): string {
  return policy.resources.find((resource) => resource.id === id)?.name ?? id;
}

export function resourcePathOf(policy: AuthorizationPolicy, id: string): string {
  const path = resourcePath(policy.resources, id);
  return path.length > 0 ? path.map(({ name }) => name).join(" / ") : id;
}

export function emptyBinding(policy: AuthorizationPolicy): AuthorizationRoleBinding {
  return { id: "", realmId: policy.realmId, subjectId: "", roleId: "", resourceId: policy.resources[0]?.id ?? "", propagation: "self", protected: false };
}
