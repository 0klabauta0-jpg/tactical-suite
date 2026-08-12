import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateReleasePreflight } from "../lib/release/preflight";

async function main() {
  const args = process.argv.slice(2);
  const valueAfter = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const requestedFeatures = (valueAfter("--features") ?? "")
    .split(",")
    .filter((value): value is "mobileStatus" | "rockbreaker3d" => value === "mobileStatus" || value === "rockbreaker3d");
  const target = valueAfter("--target");
  if (!target) throw new Error("Usage: npm run release:preflight -- --target <room> --features mobileStatus");
  const noticeText = await readFile(resolve("lib/rockbreaker/NOTICE.md"), "utf8");
  const result = {
    target,
    ...evaluateReleasePreflight({
      env: process.env,
      requestedFeatures,
      noticeText,
      expectedOrigin: valueAfter("--expected-origin") ?? "https://klabscom.vercel.app",
    }),
  };
  const output = `${JSON.stringify(result, null, 2)}\n`;
  const outputPath = valueAfter("--out");
  if (outputPath) await writeFile(resolve(outputPath), output, { encoding: "utf8", flag: "wx" });
  process.stdout.write(output);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
