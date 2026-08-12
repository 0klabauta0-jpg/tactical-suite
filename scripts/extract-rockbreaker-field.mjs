import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [sourcePath, targetPath] = process.argv.slice(2);
if (!sourcePath || !targetPath) {
  throw new Error("Usage: node scripts/extract-rockbreaker-field.mjs <source-html> <target-json>");
}

const source = await readFile(sourcePath, "utf8");
const marker = "const FIELD =";
const markerIndex = source.indexOf(marker);
if (markerIndex < 0) throw new Error("FIELD declaration not found.");
const start = source.indexOf("{", markerIndex + marker.length);
if (start < 0) throw new Error("FIELD object not found.");

let depth = 0;
let inString = false;
let escaped = false;
let end = -1;
for (let index = start; index < source.length; index += 1) {
  const character = source[index];
  if (inString) {
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
    else if (character === '"') inString = false;
    continue;
  }
  if (character === '"') inString = true;
  else if (character === "{") depth += 1;
  else if (character === "}") {
    depth -= 1;
    if (depth === 0) { end = index + 1; break; }
  }
}
if (end < 0) throw new Error("FIELD object is incomplete.");

const field = JSON.parse(source.slice(start, end));
if (!Array.isArray(field.roids) || field.roids.length !== 944) {
  throw new Error(`Expected 944 asteroids, received ${Array.isArray(field.roids) ? field.roids.length : "invalid"}.`);
}

const asteroids = field.roids.map((entry, index) => {
  if (!entry || !Number.isInteger(entry.m) || !Array.isArray(entry.p) || entry.p.length !== 3
    || !Array.isArray(entry.s) || entry.s.length !== 3
    || !entry.p.every(Number.isFinite) || !entry.s.every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error(`Invalid asteroid at index ${index}.`);
  }
  return {
    id: `rb-v1-${String(index + 1).padStart(4, "0")}`,
    meshIndex: entry.m,
    position: entry.p,
    scale: entry.s,
  };
});

const output = `${JSON.stringify(asteroids, null, 2)}\n`;
await writeFile(targetPath, output, "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
process.stdout.write(`944 asteroids\nsource sha256 ${sha256(source)}\noutput sha256 ${sha256(output)}\n`);
