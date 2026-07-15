import { buildServer } from "../apps/server/src/server.js";

if (typeof buildServer !== "function") {
  throw new Error("The development server source graph could not be resolved.");
}

console.log("Development server source graph resolves without workspace dist artifacts.");
