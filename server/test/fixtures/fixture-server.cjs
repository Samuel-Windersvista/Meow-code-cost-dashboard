// Committed test fixture: lightweight HTTP server parameterized via environment.
// Reads OBSERVATORY_FIXTURE_PORT and OBSERVATORY_FIXTURE_PID_FILE from env.
const http = require("http");
const fs = require("fs");

const port = parseInt(process.env.OBSERVATORY_FIXTURE_PORT, 10);
const pidFile = process.env.OBSERVATORY_FIXTURE_PID_FILE;

if (!port) {
  process.stderr.write("OBSERVATORY_FIXTURE_PORT is required\n");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  } else {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>OpenCode Cost Observatory</title>");
  }
});

server.listen(port, "127.0.0.1", () => {
  if (pidFile) fs.writeFileSync(pidFile, String(process.pid));
});
