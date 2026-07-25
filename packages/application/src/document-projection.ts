import type { FieldSensitivityDefinition } from "@xecms/schema";

import type { MaskPolicyRegistry } from "./mask-policies.js";
import {
  projectProtectedValue,
  resolveOutputProtection,
  type OutputProtectionDefinition,
} from "./output-protection.js";

/**
 * The server projection boundary for a single Document field. A Schema-sensitive
 * Field owns its Mask Policy; an App output binding may only strengthen it. When
 * an App has not bound an output yet (CPB-0M), a sensitive Field is masked by its
 * Schema default so the original never crosses the response boundary.
 */
export interface FieldProtectionRule {
  readonly fieldName: string;
  readonly sensitivity?: FieldSensitivityDefinition;
  readonly output?: OutputProtectionDefinition;
}

export interface ProjectDocumentDataInput {
  readonly registry: MaskPolicyRegistry;
  /** Field values already filtered by Field-access authorization (fieldName -> value). */
  readonly data: Readonly<Record<string, unknown>>;
  readonly pageAllowed: boolean;
  readonly pageUnmasked: boolean;
  readonly rules: readonly FieldProtectionRule[];
}

/**
 * Applies Field-access filtering results plus Output Protection masking before a
 * Document crosses the server response boundary. Sensitive originals are replaced
 * by masked values, so they never reach Page State or a client cache.
 */
export function projectDocumentData(input: ProjectDocumentDataInput): Record<string, unknown> {
  const ruleByField = new Map(input.rules.map((rule) => [rule.fieldName, rule]));
  const result: Record<string, unknown> = {};
  for (const [fieldName, value] of Object.entries(input.data)) {
    const rule = ruleByField.get(fieldName);
    if (rule === undefined) {
      // No sensitivity or output binding: Field-access already decided visibility.
      result[fieldName] = value;
      continue;
    }
    const protection = resolveOutputProtection({
      pageAllowed: input.pageAllowed,
      pageUnmasked: input.pageUnmasked,
      ...(rule.sensitivity === undefined ? {} : { fieldSensitivity: rule.sensitivity }),
      output: effectiveOutput(rule),
    });
    if (protection.exposure === "denied") continue;
    result[fieldName] = projectProtectedValue(input.registry, value, protection);
  }
  return result;
}

/**
 * A sensitive Field with no App output binding defaults to always-mask so that a
 * `normal` output never silently exposes it. An explicit binding wins and is
 * validated against the Schema default inside {@link resolveOutputProtection}.
 */
function effectiveOutput(rule: FieldProtectionRule): OutputProtectionDefinition {
  if (rule.output !== undefined) return rule.output;
  if (rule.sensitivity !== undefined) {
    return { mode: "always-mask", maskPolicyId: rule.sensitivity.defaultMaskPolicyId };
  }
  return { mode: "normal" };
}

/**
 * Builds projection rules from a Collection's Field summaries. Only Fields that
 * carry a Schema sensitivity or an App output binding need a rule; every other
 * Field passes through untouched once Field-access has filtered it.
 */
export function fieldProtectionRules(
  fields: readonly {
    readonly name: string;
    readonly sensitivity?: FieldSensitivityDefinition;
  }[],
  outputByFieldName: ReadonlyMap<string, OutputProtectionDefinition> = new Map(),
): readonly FieldProtectionRule[] {
  const rules: FieldProtectionRule[] = [];
  for (const field of fields) {
    const output = outputByFieldName.get(field.name);
    if (field.sensitivity === undefined && output === undefined) continue;
    rules.push({
      fieldName: field.name,
      ...(field.sensitivity === undefined ? {} : { sensitivity: field.sensitivity }),
      ...(output === undefined ? {} : { output }),
    });
  }
  return rules;
}
