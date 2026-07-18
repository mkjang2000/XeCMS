import type { AuthorizationPolicy } from "@xecms/admin";
import { Badge, Button } from "@xecms/ui";
import styles from "../../authorization.module.css";
import { permissionCategoryName, permissionTaskName } from "./vocabulary.js";

type PermissionMode = "none" | "use" | "delegate";

export function PermissionEditor({
  permissions,
  selected,
  delegated,
  query,
  technical,
  readOnly,
  onQueryChange,
  onTechnicalChange,
  onPermissionChange,
  onDelegationChange,
}: {
  readonly permissions: AuthorizationPolicy["permissions"];
  readonly selected: readonly string[];
  readonly delegated: readonly string[];
  readonly query: string;
  readonly technical: boolean;
  readonly readOnly: boolean;
  readonly onQueryChange: (value: string) => void;
  readonly onTechnicalChange: (value: boolean) => void;
  readonly onPermissionChange: (key: string, selected: boolean) => void;
  readonly onDelegationChange: (key: string, selected: boolean) => void;
}) {
  const groups = new Map<string, AuthorizationPolicy["permissions"]>();
  for (const permission of permissions) {
    groups.set(permission.category, [...(groups.get(permission.category) ?? []), permission]);
  }
  const modeOf = (key: string): PermissionMode => delegated.includes(key)
    ? "delegate"
    : selected.includes(key) ? "use" : "none";
  const setMode = (key: string, mode: PermissionMode) => {
    onPermissionChange(key, mode !== "none");
    onDelegationChange(key, mode === "delegate");
  };
  return (
    <div className={styles.permissionEditor}>
      <div className={styles.permissionToolbar}>
        <div className={styles.permissionSummary}>
          <strong>{selected.length}개 업무 허용</strong>
          <span>{delegated.length}개는 하위 역할에 위임 가능</span>
        </div>
        <div className={styles.permissionTools}>
          <label className={styles.permissionSearch}>
            <span className={styles.visuallyHidden}>권한 검색</span>
            <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="업무 또는 권한 검색" />
          </label>
          <Button size="small" variant="secondary" onPress={() => onTechnicalChange(!technical)}>
            {technical ? "업무별 간편 보기" : "권한 코드 보기"}
          </Button>
        </div>
      </div>
      {technical ? (
        <div className={styles.permissionMatrix}>
          <div className={styles.permissionHeader}><span>권한 코드</span><span>사용</span><span>위임</span></div>
          {permissions.map((permission) => (
            <div className={styles.permissionRow} key={permission.key}>
              <span className={styles.permissionName}><code>{permission.key}</code><span>{permissionTaskName(permission.key)} · {permissionCategoryName(permission.category)}</span></span>
              <label className={styles.checkboxCell}><input aria-label={`${permission.key} 사용`} type="checkbox" checked={selected.includes(permission.key)} disabled={readOnly} onChange={(event) => onPermissionChange(permission.key, event.target.checked)} /></label>
              <label className={styles.checkboxCell}><input aria-label={`${permission.key} 위임`} type="checkbox" checked={delegated.includes(permission.key)} disabled={readOnly || !selected.includes(permission.key) || !permission.delegatable || permission.protected} onChange={(event) => onDelegationChange(permission.key, event.target.checked)} /></label>
            </div>
          ))}
          {permissions.length === 0 ? <div className={styles.permissionEmpty}>검색 조건에 맞는 권한이 없습니다.</div> : null}
        </div>
      ) : (
        <div className={styles.permissionGroups}>
          {[...groups.entries()].map(([category, items]) => {
            const selectedCount = items.filter(({ key }) => selected.includes(key)).length;
            return (
              <section className={styles.permissionGroup} key={category}>
                <div className={styles.permissionGroupHeader}>
                  <div><strong>{permissionCategoryName(category)}</strong><span>{items.length}개 업무</span></div>
                  <Badge tone={selectedCount > 0 ? "success" : "neutral"}>{selectedCount}개 허용</Badge>
                </div>
                <div className={styles.permissionTaskList}>
                  {items.map((permission) => {
                    const mode = modeOf(permission.key);
                    return (
                      <article className={styles.permissionTask} key={permission.key} data-enabled={mode !== "none"}>
                        <div className={styles.permissionTaskIdentity}>
                          <strong>{permissionTaskName(permission.key)}</strong>
                          <code>{permission.key}</code>
                          {permission.hierarchyGuard !== "none" ? <span>대상과의 권한 레벨을 함께 확인합니다.</span> : null}
                        </div>
                        <div className={styles.permissionModes} role="radiogroup" aria-label={`${permissionTaskName(permission.key)} 권한 수준`}>
                          {(["none", "use", "delegate"] as const).map((option) => {
                            const disabled = readOnly || (option === "delegate" && (!permission.delegatable || permission.protected));
                            const label = option === "none" ? "허용 안 함" : option === "use" ? "사용" : "사용 + 위임";
                            return (
                              <label key={option} data-selected={mode === option} data-disabled={disabled}>
                                <input
                                  type="radio"
                                  name={`permission-${permission.key}`}
                                  value={option}
                                  checked={mode === option}
                                  disabled={disabled}
                                  onChange={() => setMode(permission.key, option)}
                                />
                                <span>{label}</span>
                              </label>
                            );
                          })}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {permissions.length === 0 ? <div className={styles.permissionEmpty}>검색 조건에 맞는 업무가 없습니다.</div> : null}
        </div>
      )}
    </div>
  );
}
