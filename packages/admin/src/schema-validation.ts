/** Must stay identical to the canonical Schema domain name grammar. */
export const SCHEMA_NAME_PATTERN = /^[a-z][A-Za-z0-9]{0,63}$/;

export const SCHEMA_NAME_ERROR_MESSAGE =
  "영문 소문자로 시작하고 영문 대소문자와 숫자만 사용해 64자 이하로 입력해 주세요.";

export function isValidSchemaName(value: string): boolean {
  return SCHEMA_NAME_PATTERN.test(value);
}

export type SchemaFormErrorPath = "name" | `fields.${number}.name` | `fields.${number}.label`;

/** Maps full Schema IR validation paths back to the collection editor form. */
export function schemaIssuePathToFormPath(path: string): SchemaFormErrorPath | null {
  const fieldMatch = path.match(/(?:^|\.)fields\.(\d+)\.(name|label)$/);
  if (fieldMatch?.[1] !== undefined && fieldMatch[2] !== undefined) {
    return `fields.${Number(fieldMatch[1])}.${fieldMatch[2] as "name" | "label"}`;
  }
  if (path === "name" || /(?:^|\.)collections\.\d+\.name$/.test(path)) return "name";
  return null;
}
