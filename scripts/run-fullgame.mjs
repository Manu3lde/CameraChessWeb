import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const appRoot = path.resolve(import.meta.dirname, "..");
const videoRoot = path.resolve(repoRoot, "video");
const publicRoot = path.resolve(appRoot, "public");
const playbackRate = Number(process.env.FULLGAME_RATE ?? 2);
const timeoutMs = Number(process.env.FULLGAME_TIMEOUT_MS ?? 900000);
const allowedVideoExtensions = new Set([".mp4", ".webm", ".mov"]);
let remoteDebuggingPort;

const whichExecutable = command => {
  try {
    const result = spawnSync("which", [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status === 0) {
      return result.stdout.trim();
    }
  } catch {
    // ignore
  }
  return null;
};

const findBrowser = () => {
  const envPath = process.env.BROWSER_PATH;
  if (envPath) {
    const resolved = path.resolve(envPath);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
    throw new Error(
      `BROWSER_PATH is set to ${envPath} but no executable was found there.`,
    );
  }

  const candidates = [];
  switch (os.platform()) {
    case "win32":
      candidates.push(
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      );
      break;
    case "darwin":
      candidates.push(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Firefox.app/Contents/MacOS/firefox",
      );
      break;
    default:
      candidates.push(
        "google-chrome-stable",
        "google-chrome",
        "chromium",
        "chromium-browser",
        "microsoft-edge",
        "microsoft-edge-stable",
      );
      break;
  }

  for (const candidate of candidates) {
    if (candidate.includes(path.sep)) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } else {
      const found = whichExecutable(candidate);
      if (found) {
        return found;
      }
    }
  }

  throw new Error(
    "No supported browser executable found. Set BROWSER_PATH to a valid Chrome/Edge/Chromium binary.",
  );
};

const listVideoFiles = () => {
  if (!fs.existsSync(videoRoot)) {
    throw new Error(`Video directory not found at ${videoRoot}`);
  }

  const files = fs
    .readdirSync(videoRoot, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name =>
      allowedVideoExtensions.has(path.extname(name).toLowerCase()),
    );

  if (files.length === 0) {
    throw new Error(
      `No video files found in ${videoRoot}. Add .mp4, .webm, or .mov, or set FULLGAME_VIDEO=<filename>`,
    );
  }

  return files;
};

const selectVideoFile = () => {
  const configuredFile = process.env.FULLGAME_VIDEO;
  if (configuredFile) {
    const filename = path.basename(configuredFile);
    const resolved = path.resolve(videoRoot, filename);
    if (!resolved.startsWith(videoRoot)) {
      throw new Error(`FULLGAME_VIDEO must be a filename inside ${videoRoot}`);
    }
    if (!fs.existsSync(resolved)) {
      throw new Error(`Video file not found: ${resolved}`);
    }
    if (!allowedVideoExtensions.has(path.extname(filename).toLowerCase())) {
      throw new Error(
        `Unsupported video extension for ${filename}. Only .mp4, .webm, and .mov are allowed.`,
      );
    }
    return filename;
  }

  return listVideoFiles()[0];
};

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Unable to allocate free port")));
      }
    });
  });

const fixtureVideoPlugin = () => ({
  name: "fixture-video",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const pathname = decodeURIComponent((req.url ?? "").split("?")[0]);
      if (
        !pathname.startsWith("/480M_pieces_float16/") &&
        !pathname.startsWith("/480L_xcorners_float16/")
      ) {
        next();
        return;
      }

      const assetPath = path.resolve(publicRoot, pathname.replace(/^\//, ""));
      if (!assetPath.startsWith(publicRoot) || !fs.existsSync(assetPath)) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      if (assetPath.endsWith(".json")) {
        res.setHeader("Content-Type", "application/json");
      } else if (assetPath.endsWith(".bin")) {
        res.setHeader("Content-Type", "application/octet-stream");
      }
      fs.createReadStream(assetPath).pipe(res);
    });

    server.middlewares.use("/fixture-video/", (req, res) => {
      const filename = decodeURIComponent((req.url ?? "").replace(/^\//, ""));
      const videoPath = path.resolve(videoRoot, filename);

      if (!videoPath.startsWith(videoRoot) || !fs.existsSync(videoPath)) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const ext = path.extname(videoPath).toLowerCase();
      let contentType = "application/octet-stream";
      if (ext === ".mp4") contentType = "video/mp4";
      else if (ext === ".webm") contentType = "video/webm";
      else if (ext === ".mov") contentType = "video/quicktime";
      res.setHeader("Content-Type", contentType);
      fs.createReadStream(videoPath).pipe(res);
    });
  },
});

const requestJson = url =>
  new Promise((resolve, reject) => {
    http
      .get(url, res => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", chunk => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
  });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const waitForWebSocketUrl = async () => {
  const deadline = Date.now() + 30000;
  let lastLog = 0;
  while (Date.now() < deadline) {
    try {
      const tabs = await requestJson(
        `http://127.0.0.1:${remoteDebuggingPort}/json/list`,
      );
      if (Array.isArray(tabs)) {
        const tab = tabs.find(entry => entry.url?.includes("/fullgame.html"));
        if (tab?.webSocketDebuggerUrl) {
          return tab.webSocketDebuggerUrl;
        }
        if (Date.now() - lastLog > 5000) {
          lastLog = Date.now();
          console.log(
            `Waiting for fullgame page: found ${tabs.length} devtools targets`,
          );
        }
      } else if (Date.now() - lastLog > 5000) {
        lastLog = Date.now();
        console.log(
          "Waiting for fullgame page: /json/list returned unexpected payload",
        );
      }
    } catch (error) {
      if (Date.now() - lastLog > 5000) {
        lastLog = Date.now();
        console.log(
          `Waiting for Edge CDP endpoint at port ${remoteDebuggingPort}: ${
            error?.message ?? error
          }
        `,
        );
      }
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for Edge remote debugging endpoint.");
};

const run = async () => {
  const browserPath = findBrowser();
  const videoFile = selectVideoFile();

  console.log("Starting Vite full-game server...");
  const server = await createServer({
    root: appRoot,
    configFile: false,
    plugins: [fixtureVideoPlugin(), react()],
    server: {
      host: "127.0.0.1",
      port: 4174,
      strictPort: false,
    },
  });
  await server.listen();
  const address = server.httpServer.address();
  const port = typeof address === "object" && address ? address.port : 4174;
  const url = `http://127.0.0.1:${port}/fullgame.html?rate=${playbackRate}&backend=cpu&video=${encodeURIComponent(videoFile)}`;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccw-fullgame-"));
  remoteDebuggingPort = Number(
    process.env.CHROME_DEBUG_PORT ?? (await getFreePort()),
  );
  console.log(`Opening ${url}`);
  console.log(`Using browser at ${browserPath}`);
  console.log(`Using debug port ${remoteDebuggingPort}`);

  const browser = spawn(browserPath, [
    `--remote-debugging-port=${remoteDebuggingPort}`,
    "--headless=new",
    `--user-data-dir=${userDataDir}`,
    "--autoplay-policy=no-user-gesture-required",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-gpu",
    url,
  ]);
  browser.stderr.on("data", chunk => {
    const text = chunk.toString().trim();
    if (text) console.error("Edge:", text);
  });

  let ws;
  let messageId = 0;
  const cleanup = async () => {
    ws?.close();
    browser.kill();
    await server.close();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // Edge can release profile files shortly after process exit.
    }
  };

  try {
    console.log("Waiting for Edge CDP endpoint...");
    const wsUrl = await waitForWebSocketUrl();
    console.log("Connected to Edge CDP endpoint.");
    ws = new WebSocket(wsUrl);
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for full-game result."));
      }, timeoutMs);
      const pending = new Map();
      let lastProgressLog = 0;
      let pollTimer;

      const send = (method, params = {}) => {
        const id = ++messageId;
        ws.send(JSON.stringify({ id, method, params }));
        return new Promise((resolveResponse, rejectResponse) => {
          pending.set(id, { resolve: resolveResponse, reject: rejectResponse });
        });
      };

      const pollPage = async () => {
        try {
          const response = await send("Runtime.evaluate", {
            returnByValue: true,
            expression: `JSON.stringify({
              status: document.getElementById("status")?.textContent ?? "loading",
              fen: document.getElementById("fen")?.textContent ?? "",
              pgn: document.getElementById("pgn")?.textContent ?? "",
              videoCurrentTime: document.querySelector("video")?.currentTime ?? 0,
              videoDuration: document.querySelector("video")?.duration ?? 0,
              videoReadyState: document.querySelector("video")?.readyState ?? 0
            })`,
          });
          const value = response.result?.result?.value;
          if (!value) return;
          const state = JSON.parse(value);
          if (Date.now() - lastProgressLog > 30000) {
            lastProgressLog = Date.now();
            const currentTime = Number.isFinite(state.videoCurrentTime)
              ? state.videoCurrentTime
              : 0;
            const duration = Number.isFinite(state.videoDuration)
              ? state.videoDuration
              : 0;
            console.log(
              `Progress: ${state.status}, ${currentTime.toFixed(1)} / ${duration.toFixed(1)} seconds`,
            );
          }
          if (state.status === "done") {
            clearTimeout(timer);
            clearInterval(pollTimer);
            resolve({
              status: "done",
              fen: state.fen,
              pgn: state.pgn,
              moves: state.pgn.replace(/^\[FEN "[^"]+"\]\s*/, "").trim(),
              lastMove: "",
              error: null,
            });
          }
        } catch (error) {
          clearTimeout(timer);
          clearInterval(pollTimer);
          reject(error);
        }
      };

      ws.addEventListener("open", () => {
        send("Runtime.enable");
        send("Page.enable");
        pollTimer = setInterval(pollPage, 2000);
      });

      ws.addEventListener("message", event => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
          const { resolve, reject } = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) {
            reject(new Error(message.error.message));
          } else {
            resolve(message);
          }
          return;
        }
        if (message.method === "Runtime.exceptionThrown") {
          console.error(
            "Browser exception:",
            message.params.exceptionDetails?.text ?? message.params,
          );
          return;
        }
        if (message.method !== "Runtime.consoleAPICalled") {
          return;
        }

        const args = message.params.args ?? [];
        const first = args[0]?.value;
        const second = args[1]?.value;
        if (message.params.type === "error" || first === "FULLGAME_ERROR") {
          console.error(
            "Browser console:",
            args.map(arg => arg.value ?? arg.description).join(" "),
          );
        }
        if (first === "FULLGAME_RESULT" && typeof second === "string") {
          clearTimeout(timer);
          clearInterval(pollTimer);
          resolve(JSON.parse(second));
        }
      });

      ws.addEventListener("error", reject);
    });

    console.log("Full-game FEN:");
    console.log(result.fen);
    console.log("");
    console.log("Full-game PGN:");
    console.log(result.pgn);
    console.log("");
    console.log("Last move:", result.lastMove || "(none)");
    if (result.error) {
      console.log("Error:", result.error);
    }
  } finally {
    await cleanup();
  }
};

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
