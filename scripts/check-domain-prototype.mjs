import { execFileSync } from "node:child_process";

const executable = new URL("../examples/domain-prototype/dist/index.js", import.meta.url);

const first = runPrototype();
const second = runPrototype();
if (first !== second) {
  console.error("Domain prototype output is not deterministic.");
  process.exitCode = 1;
} else {
  const result = JSON.parse(first);
  const checks = [
    [result.schemaChanges?.[0]?.kind === "object-renamed", "Schema rename was not detected."],
    [result.document?.state === "published-with-draft", "Document state transition failed."],
    [result.roleAssignment?.allowed === true, "Role assignment authorization failed."],
    [result.roleAssignment?.actorLevel === 80, "Grant provenance rank is missing."],
  ];
  const failures = checks.filter(([passed]) => !passed).map(([, message]) => message);
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Domain prototype is deterministic and satisfies the M0 integration scenario.");
  }
}

function runPrototype() {
  return execFileSync(process.execPath, [executable.pathname], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}
