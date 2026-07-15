import { Button, Callout, LoadingIndicator } from "@xecms/ui";
import { toAdminApiError } from "@xecms/admin";

export function PageLoading({ label = "페이지를 불러오는 중" }: { readonly label?: string }) {
  return <LoadingIndicator label={label} />;
}

export function LoadError({ error, onRetry }: { readonly error: unknown; readonly onRetry?: () => void }) {
  const apiError = toAdminApiError(error);
  return (
    <Callout tone="error">
      <strong>요청을 완료하지 못했습니다.</strong> {apiError.message}
      {onRetry ? <div><Button variant="quiet" onPress={onRetry}>다시 시도</Button></div> : null}
    </Callout>
  );
}

export function ConflictNotice({ onReload }: { readonly onReload: () => void }) {
  return (
    <Callout tone="warning">
      <strong>다른 변경이 먼저 저장되었습니다.</strong> 현재 입력을 덮어쓰지 않았습니다. 최신 버전을 불러온 뒤 다시 시도해 주세요.
      <div><Button variant="quiet" onPress={onReload}>최신 버전 불러오기</Button></div>
    </Callout>
  );
}
