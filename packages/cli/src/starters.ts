import { generateTypeScriptTypes,serializeSchema,starterSchema,type StarterName } from "@xecms/schema";

export { isStarterName,starterSchema,type StarterName } from "@xecms/schema";
export function starterArtifacts(name:StarterName){const schema=starterSchema(name);return{schema,manifest:serializeSchema(schema),types:generateTypeScriptTypes(schema)}}
