import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const expoDir = path.join(rootDir, "src", "components", "Expo-Crossy-Road");
const distDir = path.join(expoDir, "dist");
const publicDir = path.join(rootDir, "public", "expo-crossy-road");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function verifyPublicExport() {
  const file = path.join(publicDir, "index.html");
  assert(fs.existsSync(file), "Missing public/expo-crossy-road/index.html");

  const html = fs.readFileSync(file, "utf8");
  assert(
    html.includes("data-embed-path-fix"),
    "Missing embed path fix marker in public export"
  );
  assert(
    html.includes("/expo-crossy-road/_expo/static/js/web/entry-"),
    "Missing Expo entry bundle reference in public export"
  );
}

function main() {
  execSync("npm run predeploy:web", { cwd: expoDir, stdio: "inherit" });

  assert(fs.existsSync(distDir), "Expo dist directory missing after predeploy.");

  fs.rmSync(publicDir, { recursive: true, force: true });
  fs.cpSync(distDir, publicDir, { recursive: true });

  verifyPublicExport();
  console.log("Crossy web sync completed and verified.");
}

main();
