import { rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import * as esbuild from "esbuild";

const outdir = "dist-tests";
rmSync(outdir, { recursive: true, force: true });

const files = (await readdir("src/lib")).filter((name) => name.endsWith(".test.ts")).map((name) => `src/lib/${name}`);

if (files.length === 0) {
  console.error("No tests found in src/lib.");
  process.exit(1);
}

await esbuild.build({
  entryPoints: files,
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir,
  outbase: "src/lib",
});

const compiled = (await readdir(outdir)).filter((name) => name.endsWith(".test.js")).map((name) => join(outdir, name));
const result = spawnSync(process.execPath, ["--test", ...compiled], { stdio: "inherit" });
process.exit(result.status ?? 1);
