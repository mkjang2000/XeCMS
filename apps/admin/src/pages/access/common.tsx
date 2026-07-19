import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toAdminApiError, useAdminApi, type AuthorizationPolicy, type AuthorizationRoleBinding } from "@xecms/admin";
import { Callout } from "@xecms/ui";
import styles from "../../authorization.module.css";
import { PageHeader } from "../../components/page.js";
import { resourcePath } from "../../components/resource-scope-tree.js";
import { queryKeys } from "../../queries.js";

/**
 * Unified header for every authorization screen. Makes the "same screen, two
 * contexts" ambiguity explicit: a global (System) policy vs a specific user
 * space's policy — the latter shows the realm's name so operators know which
 * space they are editing. Replaces the per-page ad-hoc eyebrows.
 */
export function AccessPageHeader({
  realmId, title, description, actions,
}: {
  readonly realmId?: string;
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
}) {
  const api = useAdminApi();
  const realm = useQuery({
    queryKey: queryKeys.identityRealm(realmId ?? "missing"),
    queryFn: () => api.identityRealms.get(realmId!),
    enabled: realmId !== undefined,
  });
  const eyebrow = realmId === undefined
    ? "운영자 공간 · 권한"
    : `사용자 공간 · ${realm.data?.name ?? "…"}`;
  return (
    <PageHeader
      eyebrow={eyebrow}
      title={title}
      {...(description === undefined ? {} : { description })}
      {...(actions === undefined ? {} : { actions })}
    />
  );
}

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
