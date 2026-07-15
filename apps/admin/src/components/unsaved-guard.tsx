import { useEffect } from "react";
import { useBlocker } from "react-router";
import { ConfirmDialog } from "@xecms/ui";

export function UnsavedChangesGuard({ when }: { readonly when: boolean }) {
  const blocker = useBlocker(when);

  useEffect(() => {
    if (!when) return;
    const preventUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [when]);

  if (blocker.state !== "blocked") return null;
  return (
    <ConfirmDialog
      title="저장하지 않은 변경 사항"
      confirmLabel="변경 사항 버리기"
      danger
      onCancel={() => blocker.reset()}
      onConfirm={() => blocker.proceed()}
    >
      이 페이지를 나가면 저장하지 않은 변경 사항이 사라집니다.
    </ConfirmDialog>
  );
}
