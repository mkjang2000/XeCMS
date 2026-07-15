import { documentDisplayStateLabel, type DocumentDisplayState } from "@xecms/admin";
import { Badge } from "@xecms/ui";

const tones = {
  draft: "info",
  published: "success",
  "published-with-draft": "warning",
  archived: "neutral",
  deleted: "danger",
} as const;

export function DocumentStatus({
  state,
  announce = false,
}: {
  readonly state: DocumentDisplayState;
  readonly announce?: boolean;
}) {
  const label = documentDisplayStateLabel(state);
  return (
    <span role={announce ? "status" : undefined} aria-label={`문서 상태: ${label}`}>
      <Badge tone={tones[state]}>{label}</Badge>
    </span>
  );
}
