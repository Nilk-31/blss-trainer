import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const rendererDir = path.join(rootDir, "src", "renderer");
const sharedDir = path.join(rootDir, "src", "shared");
const outputDir = path.join(rootDir, "docs");

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(path.join(outputDir, "shared"), { recursive: true });

for (const fileName of ["index.html", "styles.css", "i18n.mjs", "gamepad.mjs", "charts.mjs", "preview.png"]) {
  await fs.copyFile(path.join(rendererDir, fileName), path.join(outputDir, fileName));
}

const appSource = await fs.readFile(path.join(rendererDir, "app.mjs"), "utf8");
await fs.writeFile(
  path.join(outputDir, "app.mjs"),
  appSource.replace("../shared/blssAnalyzer.mjs", "./shared/blssAnalyzer.mjs")
);

await fs.copyFile(
  path.join(sharedDir, "blssAnalyzer.mjs"),
  path.join(outputDir, "shared", "blssAnalyzer.mjs")
);
await fs.writeFile(path.join(outputDir, ".nojekyll"), "");

console.log(`Built static site in ${path.relative(rootDir, outputDir)}`);
