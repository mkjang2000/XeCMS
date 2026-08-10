#!/usr/bin/env node
import { main } from "@xecms/cli";

process.exitCode = await main(["init", ...process.argv.slice(2)]);
