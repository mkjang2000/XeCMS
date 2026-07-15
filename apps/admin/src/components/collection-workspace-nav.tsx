import { NavLink } from "react-router";
import styles from "../app.module.css";

export function CollectionWorkspaceNav({ collectionId }: { readonly collectionId: string }) {
  return (
    <div className={styles.workspaceNav} role="group" aria-label="컬렉션 보기">
      <NavLink end to={`/admin/content/${collectionId}`}>문서 목록</NavLink>
      <NavLink to={`/admin/content/${collectionId}/trash`}>휴지통</NavLink>
    </div>
  );
}
