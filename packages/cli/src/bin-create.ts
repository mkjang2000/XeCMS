#!/usr/bin/env node
import { main } from "./cli.js";
process.exitCode=await main(["init",...process.argv.slice(2)]);
