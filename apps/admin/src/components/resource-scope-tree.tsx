import type {
  AuthorizationResource,
  AuthorizationScopePropagation,
} from "@xecms/admin";
import styles from "../authorization.module.css";

export interface ResourceTreeNode {
  readonly resource: AuthorizationResource;
  readonly children: readonly ResourceTreeNode[];
}

/**
 * Turns the policy's parentId edges into a forest without trusting the server
 * ordering. Invalid/orphan/cyclic resources remain visible as top-level nodes
 * so an administrator can still select and repair their bindings.
 */
export function buildResourceTree(
  resources: readonly AuthorizationResource[],
): readonly ResourceTreeNode[] {
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
  const childrenByParent = new Map<string, AuthorizationResource[]>();
  const roots: AuthorizationResource[] = [];

  for (const resource of resources) {
    if (
      resource.parentId === undefined
      || resource.parentId === resource.id
      || !resourcesById.has(resource.parentId)
    ) {
      roots.push(resource);
      continue;
    }
    const siblings = childrenByParent.get(resource.parentId) ?? [];
    siblings.push(resource);
    childrenByParent.set(resource.parentId, siblings);
  }

  const visited = new Set<string>();
  const materialize = (
    resource: AuthorizationResource,
    ancestors: ReadonlySet<string>,
  ): ResourceTreeNode => {
    visited.add(resource.id);
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(resource.id);
    const children = (childrenByParent.get(resource.id) ?? [])
      .filter((child) => !nextAncestors.has(child.id))
      .map((child) => materialize(child, nextAncestors));
    return { resource, children };
  };

  const forest = roots.map((resource) => materialize(resource, new Set()));
  for (const resource of resources) {
    if (!visited.has(resource.id)) forest.push(materialize(resource, new Set()));
  }
  return forest;
}

export function resourcePath(
  resources: readonly AuthorizationResource[],
  resourceId: string,
): readonly AuthorizationResource[] {
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
  const path: AuthorizationResource[] = [];
  const visited = new Set<string>();
  let current = resourcesById.get(resourceId);
  while (current !== undefined && !visited.has(current.id)) {
    visited.add(current.id);
    path.unshift(current);
    current = current.parentId === undefined
      ? undefined
      : resourcesById.get(current.parentId);
  }
  return path;
}

function resourceTypeLabel(type: string): string {
  switch (type) {
    case "realm": return "Realm";
    case "workspace": return "Workspace";
    case "section": return "영역";
    case "collection": return "Collection";
    case "document": return "Document";
    default: return type;
  }
}

function ResourceNode({
  node,
  value,
  onChange,
  isSelectable,
  isDisabled,
}: {
  readonly node: ResourceTreeNode;
  readonly value: string;
  readonly onChange: (resourceId: string) => void;
  readonly isSelectable: (resource: AuthorizationResource) => boolean;
  readonly isDisabled: boolean;
}) {
  const selected = value === node.resource.id;
  const selectable = !isDisabled && isSelectable(node.resource);
  return (
    <li
      className={styles.scopeTreeItem}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={node.children.length > 0 ? true : undefined}
    >
      <button
        className={styles.scopeTreeButton}
        type="button"
        data-selected={selected}
        disabled={!selectable}
        aria-label={`${node.resource.name}, ${resourceTypeLabel(node.resource.type)}${selected ? ", 선택됨" : ""}`}
        onClick={() => onChange(node.resource.id)}
      >
        <span className={styles.scopeTreeBranch} aria-hidden="true" />
        <span className={styles.scopeTreeName}>{node.resource.name}</span>
        <span className={styles.scopeTreeType}>{resourceTypeLabel(node.resource.type)}</span>
        {selected ? <span className={styles.scopeTreeSelected}>선택됨</span> : null}
      </button>
      {node.children.length > 0 ? (
        <ul className={styles.scopeTreeGroup} role="group">
          {node.children.map((child) => (
            <ResourceNode
              key={child.resource.id}
              node={child}
              value={value}
              onChange={onChange}
              isSelectable={isSelectable}
              isDisabled={isDisabled}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const propagationOptions: readonly {
  readonly value: AuthorizationScopePropagation;
  readonly label: string;
  readonly description: string;
}[] = [
  { value: "self", label: "현재 리소스", description: "선택한 리소스에만 적용" },
  {
    value: "children",
    label: "하위만 (현재 제외)",
    description: "선택한 리소스 자체에는 적용하지 않고 모든 깊이의 후손에만 적용",
  },
  {
    value: "self-and-children",
    label: "현재 + 모든 하위",
    description: "선택한 리소스 자체와 모든 깊이의 후손에 함께 적용",
  },
];

export function ScopeTreeSelector({
  label,
  description,
  resources,
  value,
  onChange,
  allowEmpty = false,
  emptyLabel = "제한 없음",
  isSelectable = () => true,
  propagation,
  onPropagationChange,
  isDisabled = false,
}: {
  readonly label: string;
  readonly description?: string;
  readonly resources: readonly AuthorizationResource[];
  readonly value: string;
  readonly onChange: (resourceId: string) => void;
  readonly allowEmpty?: boolean;
  readonly emptyLabel?: string;
  readonly isSelectable?: (resource: AuthorizationResource) => boolean;
  readonly propagation?: AuthorizationScopePropagation;
  readonly onPropagationChange?: (propagation: AuthorizationScopePropagation) => void;
  readonly isDisabled?: boolean;
}) {
  const forest = buildResourceTree(resources);
  const selectedPath = value === "" ? [] : resourcePath(resources, value);
  return (
    <fieldset className={styles.scopeFieldset}>
      <legend>{label}</legend>
      {description ? <p className={styles.scopeDescription}>{description}</p> : null}
      <div className={styles.scopeTreeViewport}>
        {allowEmpty ? (
          <button
            className={styles.scopeEmptyButton}
            type="button"
            data-selected={value === ""}
            aria-pressed={value === ""}
            disabled={isDisabled}
            onClick={() => onChange("")}
          >
            <span>{emptyLabel}</span>
            <small>모든 필드를 허용합니다.</small>
          </button>
        ) : null}
        <ul
          className={styles.scopeTree}
          role="tree"
          aria-label={`${label} 리소스 트리`}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              `.${styles.scopeTreeButton}:not(:disabled)`,
            )];
            if (buttons.length === 0) return;
            const currentIndex = buttons.findIndex((button) => button === document.activeElement);
            const nextIndex = event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : event.key === "ArrowDown"
                  ? Math.min(buttons.length - 1, currentIndex + 1)
                  : Math.max(0, currentIndex < 0 ? 0 : currentIndex - 1);
            buttons[nextIndex]?.focus();
            event.preventDefault();
          }}
        >
          {forest.map((node) => (
            <ResourceNode
              key={node.resource.id}
              node={node}
              value={value}
              onChange={onChange}
              isSelectable={isSelectable}
              isDisabled={isDisabled}
            />
          ))}
        </ul>
      </div>
      {value ? (
        <div className={styles.scopeSelection} aria-live="polite">
          <span>선택 경로</span>
          <strong>{selectedPath.map(({ name }) => name).join(" / ") || value}</strong>
        </div>
      ) : null}
      {propagation !== undefined && onPropagationChange !== undefined ? (
        <>
          <div className={styles.propagationGroup} role="radiogroup" aria-label="Scope 전파 방식">
            {propagationOptions.map((option) => (
              <label key={option.value} data-selected={propagation === option.value}>
                <input
                  type="radio"
                  name={`${label}-propagation`}
                  value={option.value}
                  checked={propagation === option.value}
                  disabled={isDisabled}
                  onChange={() => onPropagationChange(option.value)}
                />
                <span><strong>{option.label}</strong><small>{option.description}</small></span>
              </label>
            ))}
          </div>
          {propagation === "children" ? (
            <p className={styles.scopeDescription} role="note">
              주의: 현재 선택한 리소스에서는 이 역할이 적용되지 않습니다. 현재 리소스도
              포함하려면 ‘현재 + 모든 하위’를 선택하세요.
            </p>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}
