import type {
  ComponentDefinition,
  ComposedPageDefinition,
  ConnectionDefinition,
  DataSourceDefinition,
  PageStateDefinition,
  PortReference,
} from "@xecms/admin-apps";

export type PortDirection = "out" | "in";
export type PortValueType =
  | "string" | "number" | "boolean" | "date" | "datetime"
  | "document-id" | "document[]" | "event" | "any";

export interface PortSpec {
  readonly portId: string;
  readonly label: string;
  readonly direction: PortDirection;
  readonly valueType: PortValueType;
  /** Input ports that reject more than one inbound connection. */
  readonly single?: boolean;
}

/** Ports a component kind exposes in the Builder (mirrors runtime port heuristics). */
interface AdaptiveVariantProp {
  readonly id: string;
  readonly label?: string;
  readonly inputKind?: "text" | "number" | "date" | "select";
}

export function componentPorts(component: ComponentDefinition): readonly PortSpec[] {
  switch (component.kind) {
    case "core.input.text":
    case "core.input.scan":
      return [{ portId: "value", label: "값", direction: "out", valueType: "string" }];
    case "core.input.number":
      return [{ portId: "value", label: "값", direction: "out", valueType: "number" }];
    case "core.input.adaptive": {
      // One output port per variant, typed by the variant's input kind.
      const variants = Array.isArray(component.props["variants"])
        ? (component.props["variants"] as readonly AdaptiveVariantProp[])
        : [];
      return variants.map((variant) => ({
        portId: `value:${variant.id}`,
        label: variant.label ?? variant.id,
        direction: "out" as const,
        valueType: variantValueType(variant.inputKind),
      }));
    }
    case "core.button":
      return [{ portId: "clicked", label: "클릭", direction: "out", valueType: "event" }];
    case "core.output.table":
      return [
        { portId: "data", label: "데이터", direction: "in", valueType: "document[]", single: true },
        { portId: "selectedDocumentId", label: "선택", direction: "out", valueType: "document-id" },
      ];
    case "core.output.detail":
      return [{ portId: "documentId", label: "문서 ID", direction: "in", valueType: "document-id", single: true }];
    case "core.output.chart":
      // Fed by an aggregate Data Source's rows port (slG2).
      return [{ portId: "data", label: "데이터", direction: "in", valueType: "document[]", single: true }];
    default:
      return [];
  }
}

function variantValueType(inputKind: AdaptiveVariantProp["inputKind"]): PortValueType {
  if (inputKind === "number") return "number";
  if (inputKind === "date") return "date";
  return "string";
}

export function statePorts(state: PageStateDefinition): readonly PortSpec[] {
  const valueType: PortValueType = state.valueType === "string[]" ? "any" : state.valueType;
  return [
    { portId: "value", label: "값", direction: "out", valueType },
    { portId: "write", label: "쓰기", direction: "in", valueType, single: true },
  ];
}

export function dataSourcePorts(source: DataSourceDefinition): readonly PortSpec[] {
  const parameterPorts = (source.parameters ?? []).map((parameter): PortSpec => ({
    portId: `parameter:${parameter.id}`,
    label: `파라미터 ${parameter.id}`,
    direction: "in",
    valueType: parameter.valueType === "string[]" ? "any" : parameter.valueType,
    single: true,
  }));
  return [
    { portId: "execute", label: "실행", direction: "in", valueType: "event", single: true },
    { portId: "rows", label: "행", direction: "out", valueType: "document[]" },
    ...parameterPorts,
  ];
}

export function portsFor(
  page: ComposedPageDefinition,
  reference: Pick<PortReference, "nodeType" | "nodeId">,
): readonly PortSpec[] {
  if (reference.nodeType === "component") {
    const component = page.components.find(({ id }) => id === reference.nodeId);
    return component === undefined ? [] : componentPorts(component);
  }
  if (reference.nodeType === "state") {
    const state = page.state.find(({ id }) => id === reference.nodeId);
    return state === undefined ? [] : statePorts(state);
  }
  const source = page.dataSources.find(({ id }) => id === reference.nodeId);
  return source === undefined ? [] : dataSourcePorts(source);
}

export function findPort(page: ComposedPageDefinition, reference: PortReference): PortSpec | undefined {
  return portsFor(page, reference).find(({ portId }) => portId === reference.portId);
}

/** Value types connect when equal, or when either side accepts anything. */
export function typesCompatible(from: PortValueType, to: PortValueType): boolean {
  if (from === "any" || to === "any") return true;
  return from === to;
}

export interface ConnectionAttempt {
  readonly from: PortReference;
  readonly to: PortReference;
}

/** Whether a proposed connection is valid without mutating the page. */
export function canConnect(page: ComposedPageDefinition, attempt: ConnectionAttempt): boolean {
  const from = findPort(page, attempt.from);
  const to = findPort(page, attempt.to);
  if (from === undefined || to === undefined) return false;
  if (from.direction !== "out" || to.direction !== "in") return false;
  if (!typesCompatible(from.valueType, to.valueType)) return false;
  if (attempt.from.nodeId === attempt.to.nodeId && attempt.from.nodeType === attempt.to.nodeType) return false;
  if (to.single === true && hasInbound(page, attempt.to)) return false;
  if (wouldCycle(page, attempt.from.nodeId, attempt.to.nodeId)) return false;
  return true;
}

function hasInbound(page: ComposedPageDefinition, port: PortReference): boolean {
  return page.connections.some((connection) =>
    connection.to.nodeType === port.nodeType
    && connection.to.nodeId === port.nodeId
    && connection.to.portId === port.portId);
}

function wouldCycle(page: ComposedPageDefinition, fromNode: string, toNode: string): boolean {
  if (fromNode === toNode) return true;
  const adjacency = new Map<string, string[]>();
  for (const connection of page.connections) {
    const list = adjacency.get(connection.from.nodeId) ?? [];
    list.push(connection.to.nodeId);
    adjacency.set(connection.from.nodeId, list);
  }
  // Adding fromNode → toNode closes a cycle iff toNode already reaches fromNode.
  const stack = [toNode];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === fromNode) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    stack.push(...(adjacency.get(node) ?? []));
  }
  return false;
}

export function newConnectionId(existing: readonly ConnectionDefinition[]): string {
  let index = existing.length + 1;
  const ids = new Set(existing.map(({ id }) => id));
  while (ids.has(`conn_${index}`)) index += 1;
  return `conn_${index}`;
}
