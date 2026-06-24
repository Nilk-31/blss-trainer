import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const rendererDir = path.join(rootDir, "src", "renderer");
const sharedDir = path.join(rootDir, "src", "shared");
const outputDir = path.join(rootDir, "docs");
const execFileAsync = promisify(execFile);
const buildVersion = await getBuildVersion();

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(path.join(outputDir, "shared"), { recursive: true });

for (const fileName of ["styles.css", "preview.png"]) {
  await fs.copyFile(path.join(rendererDir, fileName), path.join(outputDir, fileName));
}

for (const [sourceName, outputName] of [
  ["i18n.mjs", "i18n.js"],
  ["gamepad.mjs", "gamepad.js"],
  ["charts.mjs", "charts.js"]
]) {
  await fs.copyFile(path.join(rendererDir, sourceName), path.join(outputDir, outputName));
  await fs.copyFile(path.join(rendererDir, sourceName), path.join(outputDir, sourceName));
}

const indexSource = await fs.readFile(path.join(rendererDir, "index.html"), "utf8");
await fs.writeFile(
  path.join(outputDir, "index.html"),
  indexSource
    .replace('./styles.css"', `./styles.css?v=${buildVersion}"`)
    .replace('./app.mjs"', `./app.js?v=${buildVersion}"`)
);

const appSource = await fs.readFile(path.join(rendererDir, "app.mjs"), "utf8");
await fs.writeFile(
  path.join(outputDir, "app.js"),
  appSource
    .replace("../shared/blssAnalyzer.mjs", `./shared/blssAnalyzer.js?v=${buildVersion}`)
    .replace("./gamepad.mjs", `./gamepad.js?v=${buildVersion}`)
    .replace("./charts.mjs", `./charts.js?v=${buildVersion}`)
    .replace("./i18n.mjs", `./i18n.js?v=${buildVersion}`)
);
await fs.writeFile(
  path.join(outputDir, "app.mjs"),
  appSource
    .replace("../shared/blssAnalyzer.mjs", `./shared/blssAnalyzer.mjs?v=${buildVersion}`)
    .replace("./gamepad.mjs", `./gamepad.mjs?v=${buildVersion}`)
    .replace("./charts.mjs", `./charts.mjs?v=${buildVersion}`)
    .replace("./i18n.mjs", `./i18n.mjs?v=${buildVersion}`)
);

await fs.copyFile(
  path.join(sharedDir, "blssAnalyzer.mjs"),
  path.join(outputDir, "shared", "blssAnalyzer.js")
);
await fs.copyFile(
  path.join(sharedDir, "blssAnalyzer.mjs"),
  path.join(outputDir, "shared", "blssAnalyzer.mjs")
);
await fs.writeFile(path.join(outputDir, ".nojekyll"), "");

console.log(`Built static site in ${path.relative(rootDir, outputDir)}`);

async function getBuildVersion() {
  try {
    const { stdout: commitStdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: rootDir });
    const { stdout: statusStdout } = await execFileAsync("git", ["status", "--short"], { cwd: rootDir });
    const commit = commitStdout.trim() || Date.now().toString(36);
    return statusStdout.trim() ? `${commit}-${Date.now().toString(36)}` : commit;
  } catch {
    return Date.now().toString(36);
  }
}
