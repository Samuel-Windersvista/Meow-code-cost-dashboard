import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const spawnBackendScript = fileURLToPath(new URL("./spawn-backend.cjs", import.meta.url))

async function killProcess(pid: number) {
  await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]).catch(() => {
    // Best-effort cleanup.
  })
}

test("spawn-backend.cjs accepts BOM-prefixed JSON payload files", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oco-spawn-backend-bom-"))
  const payloadPath = path.join(root, "spawn-payload.json")
  const pidPath = path.join(root, "managed.pid")
  const stdinPath = path.join(root, "stdin.txt")
  const stdoutLogPath = path.join(root, "managed.out.log")
  const stderrLogPath = path.join(root, "managed.err.log")
  const errorPath = path.join(root, "spawn.err.log")

  fs.writeFileSync(stdinPath, "")

  const payload = {
    nodeExecutable: process.execPath,
    args: ["-e", "setInterval(() => {}, 10000)"],
    cwd: root,
    stdinPath,
    stdoutLogPath,
    stderrLogPath,
    pidPath,
    errorPath,
  }

  fs.writeFileSync(payloadPath, `\uFEFF${JSON.stringify(payload)}`, "utf8")

  let childPid: number | undefined
  try {
    await execFileAsync(process.execPath, [spawnBackendScript, payloadPath], { cwd: root })

    assert.ok(fs.existsSync(pidPath), "expected helper to write managed pid file")

    childPid = Number(fs.readFileSync(pidPath, "utf8").trim())
    assert.ok(Number.isInteger(childPid) && childPid > 0, "expected helper to write a numeric pid")
    assert.ok(!fs.existsSync(errorPath), "expected helper not to write a spawn error log")
  } finally {
    if (childPid) {
      await killProcess(childPid)
    }
  }
})
