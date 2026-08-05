import { readdir, readFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

const moduleRoot = fileURLToPath(new URL("..", import.meta.url));
const files = await walk(moduleRoot);
const jsonFiles = files.filter(path => extname(path) === ".json");
for (const path of jsonFiles) JSON.parse(await readFile(path, "utf8"));

const jsFiles = files.filter(path => [".js", ".mjs"].includes(extname(path)));
for (const path of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `Syntax check failed: ${path}`);
}

const manifest = JSON.parse(await readFile(join(moduleRoot, "module.json"), "utf8"));
for (const path of [...(manifest.esmodules ?? []), ...(manifest.styles ?? []), ...(manifest.languages ?? []).map(language => language.path)]) {
  await access(join(moduleRoot, path));
}

const forbiddenPatterns = [
  "flags.maestro",
  "html.find(",
  "CHAT_MESSAGE_TYPES",
  "CHAT_MESSAGE_STYLES",
  "globalThis.FormApplication",
  'Hooks.on("renderChatMessage",',
  "message.setFlag("
];
for (const path of jsFiles) {
  if (path === fileURLToPath(import.meta.url)) continue;
  const text = await readFile(path, "utf8");
  for (const pattern of forbiddenPatterns) {
    if (text.includes(pattern)) throw new Error(`${relative(moduleRoot, path)} contains forbidden legacy pattern: ${pattern}`);
  }
}

console.log(`Validated ${jsonFiles.length} JSON files, ${jsFiles.length} JavaScript files, and all manifest paths.`);
