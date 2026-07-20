import { useQuery } from "@tanstack/react-query";
import {
  useAdminApi,
  type AccessEvaluationCheck,
} from "@xecms/admin";
import { queryKeys } from "./queries.js";

export const systemResources = {
  workspace: "resource:workspace",
  schema: "resource:schema",
  content: "resource:content",
  authorization: "resource:authorization",
  audit: "resource:audit",
} as const;

export function permissionCheck(
  id: string,
  action: string,
  resourceId: string,
): AccessEvaluationCheck {
  return { id, type: "permission", action, resourceId };
}

export function useAccessProfile(
  scope: string,
  checks: readonly AccessEvaluationCheck[],
  enabled = true,
) {
  const api = useAdminApi();
  return useQuery({
    queryKey: queryKeys.accessProfile(scope, checks.map(({ id }) => id)),
    queryFn: () => api.access.evaluateBatch({ checks }),
    staleTime: 15_000,
    enabled,
  });
}
