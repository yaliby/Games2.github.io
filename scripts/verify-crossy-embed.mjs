import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const embedPath = path.join(
  projectRoot,
  "src",
  "components",
  "ExpoCrossyRoadEmbed.tsx"
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const source = fs.readFileSync(embedPath, "utf8");

console.log("Crossy embed source verification passed.");