import { readdir, readFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Recursively collect project files while ignoring dependency directories. */
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

/** Return a manifest path resolved inside the module root. */
function safeManifestPath(moduleRoot, manifestPath) {
  const target = resolve(moduleRoot, String(manifestPath ?? ""));
  const rootPrefix = moduleRoot.endsWith(sep) ? moduleRoot : `${moduleRoot}${sep}`;
  if (target !== moduleRoot && !target.startsWith(rootPrefix)) {
    throw new Error(`Manifest path escapes module root: ${manifestPath}`);
  }
  return target;
}

/** Compare localization keys and reject non-string translations. */
function validateLocalizations(localizations) {
  const [referenceLanguage, reference] = localizations[0] ?? [];
  if (!reference) return;
  const referenceKeys = Object.keys(reference).sort();
  for (const [language, data] of localizations) {
    const keys = Object.keys(data).sort();
    const missing = referenceKeys.filter(key => !Object.hasOwn(data, key));
    const extra = keys.filter(key => !Object.hasOwn(reference, key));
    if (missing.length || extra.length) {
      throw new Error(`${language} localization key mismatch. Missing: ${missing.join(", ") || "none"}. Extra: ${extra.join(", ") || "none"}.`);
    }
    for (const [key, value] of Object.entries(data)) {
      if (typeof value !== "string") throw new Error(`${language}.${key} must be a string`);
    }
  }
  console.log(`Localization parity verified against ${referenceLanguage}.`);
}

/** Enforce documentation on named source functions. */
function validateDocstrings(text, path) {
  const functionPattern = /^(\s*)(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/gm;
  let match;
  let total = 0;
  let documented = 0;
  while ((match = functionPattern.exec(text))) {
    total += 1;
    const prefix = text.slice(0, match.index);
    if (/\/\*\*[\s\S]*?\*\/\s*$/.test(prefix)) documented += 1;
  }
  if (total && documented / total < 0.8) {
    throw new Error(`${path} documents only ${documented}/${total} named functions`);
  }
  return { total, documented };
}

const moduleRoot = fileURLToPath(new URL("..", import.meta.url));
const files = await walk(moduleRoot);
const jsonFiles = files.filter(path => extname(path) === ".json");
const parsedJson = new Map();
for (const path of jsonFiles) parsedJson.set(path, JSON.parse(await readFile(path, "utf8")));

const jsFiles = files.filter(path => [".js", ".mjs"].includes(extname(path)));
let documentedFunctions = 0;
let namedFunctions = 0;
for (const path of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `Syntax check failed: ${path}`);
  if (path !== fileURLToPath(import.meta.url) && !path.includes(`${sep}tests${sep}`)) {
    const source = await readFile(path, "utf8");
    const coverage = validateDocstrings(source, relative(moduleRoot, path));
    documentedFunctions += coverage.documented;
    namedFunctions += coverage.total;
  }
}

const manifestPath = join(moduleRoot, "module.json");
const packagePath = join(moduleRoot, "package.json");
const manifest = parsedJson.get(manifestPath);
const packageJson = parsedJson.get(packagePath);
if (manifest.id !== packageJson.name) throw new Error(`module id ${manifest.id} does not match package name ${packageJson.name}`);
if (manifest.version !== packageJson.version) throw new Error(`module version ${manifest.version} does not match package version ${packageJson.version}`);

const referencedPaths = [
  ...(manifest.esmodules ?? []),
  ...(manifest.styles ?? []),
  ...(manifest.languages ?? []).map(language => language.path),
  manifest.license
].filter(Boolean);
for (const path of referencedPaths) await access(safeManifestPath(moduleRoot, path));

const localizations = (manifest.languages ?? []).map(language => [
  language.lang,
  parsedJson.get(safeManifestPath(moduleRoot, language.path))
]);
validateLocalizations(localizations);

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

console.log(`Validated ${jsonFiles.length} JSON files, ${jsFiles.length} JavaScript files, ${documentedFunctions}/${namedFunctions} documented named functions, and all manifest paths.`);
