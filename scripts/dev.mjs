import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";

// This helper runs an actual mongod with WiredTiger storage, not a mock or an
// ephemeral database. Never call its default cleanup: that can remove dbPath.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backend = path.join(root, "backend");
const frontend = path.join(root, "frontend");
const data = path.join(root, ".data");
const flags = new Set(process.argv.slice(2));
const allowed = new Set(["--backend-only", "--check", "--test-mongo", "--external-mongo"]);
const backendOnly = flags.has("--backend-only") || flags.has("--check") || flags.has("--test-mongo");
const children = new Set();
let mongo;
let closing = false;

function run(command, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with code ${code}`)));
  });
}

async function freePort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Port ${port} is already in use. Stop that service first.${port === 3000 ? " If your frontend is already running, use npm run dev:backend instead." : ""}`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

function service(command, args, cwd, env) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit", windowsHide: true, detached: process.platform !== "win32" });
  children.add(child);
  child.once("error", (error) => { console.error(error.message); void shutdown(1); });
  child.once("exit", (code) => {
    children.delete(child);
    if (!closing) {
      console.error(`\nA Kazi service stopped unexpectedly (code ${code}). Check the error above.`);
      void shutdown(1);
    }
  });
  return child;
}

async function stopChild(child) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    // Only terminate the process tree that this launcher created.
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 10000 });
  } else {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already stopped. */ }
  }
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { process.platform === "win32" ? child.kill("SIGKILL") : process.kill(-child.pid, "SIGKILL"); } catch { /* Already stopped. */ }
      resolve();
    }, 5000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    if (child.exitCode !== null) { clearTimeout(timer); resolve(); }
  });
}

async function shutdown(code) {
  if (closing) return;
  closing = true;
  console.log("\nStopping Kazi services. Your local database is preserved.");
  await Promise.all([...children].map(stopChild));
  if (mongo) {
    try { await mongo.stop({ doCleanup: false, force: false }); }
    catch (error) { console.error(`Mongo shutdown: ${error.message}`); code = 1; }
  }
  process.exit(code);
}
process.once("SIGINT", () => { void shutdown(0); });
process.once("SIGTERM", () => { void shutdown(0); });

async function ready(url, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (response.ok) return response;
    } catch { /* The service may still be booting. */ }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${url}. Check service logs above.`);
}

async function pythonEnvironment() {
  const executable = path.join(backend, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  if (!existsSync(executable)) {
    const candidates = process.platform === "win32" ? [["py", "-3"], ["python"], ["python3"]] : [["python3"], ["python"]];
    const candidate = candidates.find(([command, ...args]) => {
      const result = spawnSync(command, [...args, "--version"], { encoding: "utf8", timeout: 10000, windowsHide: true });
      const version = /Python (\d+)\.(\d+)/.exec(`${result.stdout || ""} ${result.stderr || ""}`);
      return result.status === 0 && version && Number(version[1]) === 3 && Number(version[2]) >= 11;
    });
    if (!candidate) throw new Error("Python 3.11+ is required. Install it with the Python launcher/on PATH, then rerun npm run dev.");
    console.log("Creating backend/.venv…");
    await run(candidate[0], [...candidate.slice(1), "-m", "venv", ".venv"], backend);
  }
  const manifest = await readFile(path.join(backend, "pyproject.toml"));
  const hash = createHash("sha256").update(manifest).digest("hex");
  const marker = path.join(data, "backend-dependencies.sha256");
  const previous = await readFile(marker, "utf8").catch(() => "");
  const imports = spawnSync(executable, ["-c", "import fastapi, pymongo, uvicorn"], { stdio: "ignore", windowsHide: true, timeout: 10000 });
  if (previous !== hash || imports.status !== 0) {
    console.log("Installing/checking backend dependencies…");
    await run(executable, ["-m", "pip", "install", "--upgrade", "pip>=26.2.2"], backend);
    await run(executable, ["-m", "pip", "install", "-e", ".[test]"], backend);
    await writeFile(marker, hash);
  }
  return executable;
}

async function main() {
  for (const flag of flags) if (!allowed.has(flag)) throw new Error(`Unknown option: ${flag}`);
  await freePort(8000);
  if (!backendOnly) await freePort(3000);
  if (!flags.has("--external-mongo")) await freePort(27017);
  await mkdir(data, { recursive: true });
  const python = await pythonEnvironment();
  if (!backendOnly && !existsSync(path.join(frontend, "node_modules", "next"))) {
    const cli = process.env.npm_execpath;
    if (!cli) throw new Error("Run via npm run dev so frontend dependencies can be installed.");
    await run(process.execPath, [cli, "ci"], frontend);
  }
  const apiEnvironment = { FRONTEND_ORIGIN: "http://localhost:3000", ENVIRONMENT: "development", COOKIE_SECURE: "false" };
  let uri;
  if (!flags.has("--external-mongo")) {
    const dbPath = path.join(data, "mongo");
    await mkdir(dbPath, { recursive: true });
    console.log("Starting real MongoDB on loopback with persistent WiredTiger storage.");
    console.log("First use downloads MongoDB 8.0.17 from fastdl.mongodb.org (Windows archive ~756 MiB). Cached afterward.");
    // Assign before start so even a partially failed launch gets shut down.
    mongo = new MongoMemoryReplSet({
      binary: { version: "8.0.17", downloadDir: path.join(data, "mongodb-binaries"), checkMD5: true },
      instanceOpts: [{ port: 27017, dbPath, launchTimeout: 60000 }],
      replSet: { name: "rs0", count: 1, ip: "127.0.0.1", storageEngine: "wiredTiger" },
    });
    await mongo.start();
    uri = mongo.getUri("kazi");
    apiEnvironment.MONGO_URI = uri;
    apiEnvironment.MONGO_DATABASE = "kazi";
  }
  console.log("Starting FastAPI…");
  service(python, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000", "--workers", "1", "--no-proxy-headers"], backend, apiEnvironment);
  await ready("http://127.0.0.1:8000/api/health");
  console.log("API and database are ready: http://127.0.0.1:8000/api/health");
  if (flags.has("--test-mongo")) {
    if (!uri) throw new Error("test:mongo uses the managed local database; do not combine with --external-mongo.");
    await run(python, ["-m", "pytest", "tests/test_mongo_integration.py", "-v"], backend, { KAZI_TEST_MONGO_URI: uri });
    await shutdown(0);
  } else if (flags.has("--check")) {
    console.log("Local backend startup check passed.");
    await shutdown(0);
  } else if (!backendOnly) {
    console.log("Starting Next.js…");
    service(process.execPath, [path.join(frontend, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "127.0.0.1", "--port", "3000"], frontend, { BACKEND_URL: "http://127.0.0.1:8000" });
    await ready("http://127.0.0.1:3000/login", 90000);
    console.log("\nKazi is ready: http://localhost:3000\nKeep this terminal open. Ctrl+C stops services, not your saved data.");
  } else {
    console.log("\nBackend ready. Keep this terminal open and refresh your frontend at http://localhost:3000.");
  }
}
main().catch(async (error) => { console.error(`\nKazi startup failed: ${error.message}`); await shutdown(1); });
