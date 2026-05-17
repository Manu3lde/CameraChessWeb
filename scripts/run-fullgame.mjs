import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const appRoot = path.resolve(import.meta.dirname, "..");
const videoRoot = path.resolve(repoRoot, "video");
const publicRoot = path.resolve(appRoot, "public");
const playbackRate = Number(process.env.FULLGAME_RATE ?? 2);
const timeoutMs = Number(process.env.FULLGAME_TIMEOUT_MS ?? 900000);
let remoteDebuggingPort;

/**
 * Find a Chromium-family browser executable across platforms.
 * Priority: env var BROWSER_PATH > common install locations.
 */
const findBrowser = () => {
  if (process.env.BROWSER_PATH && fs.existsSync(process.env.BROWSER_PATH)) {
    return process.env.BROWSER_PATH;
  }

  const candidates = [
    // Windows – Edge
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    // Windows – Chrome
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    // macOS – Chrome
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    // macOS – Edge
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    // macOS – Chromium
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // Linux / CI – try PATH
  for (const cmd of [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
  ]) {
    try {
      const result = execSync(`which ${cmd} 2>/dev/null`, {
        encoding: "utf8",
      }).trim();
      if (result) return result;
    } catch {
      // not found, continue
    }
  }

  return null;
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

      res.setHeader("Content-Type", "video/mp4");
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
          `Waiting for browser CDP endpoint at port ${remoteDebuggingPort}: ${
            error?.message ?? error
          }`,
        );
      }
    }
    await sleep(250);
  }
  throw new Error("Timed out waiting for browser remote debugging endpoint.");
};

// List video files available in the video directory
const listVideoFiles = () => {
  if (!fs.existsSync(videoRoot)) return [];
  return fs.readdirSync(videoRoot).filter(f => /\.(mp4|webm|mov)$/i.test(f));
};

const run = async () => {
  const browserPath = findBrowser();
  if (!browserPath) {
    throw new Error(
      "No Chromium-family browser found.\n" +
        "Install Google Chrome, Chromium, or Microsoft Edge, " +
        "or set the BROWSER_PATH environment variable to the executable path.",
    );
  }
  console.log(`Using browser: ${browserPath}`);

  // Pick first available video if no env override
  const videoFiles = listVideoFiles();
  if (videoFiles.length === 0) {
    throw new Error(
      `No video files found in ${videoRoot}.\n` +
        "Add an .mp4 file to the video/ directory at the repo root.",
    );
  }
  const videoFile = process.env.FULLGAME_VIDEO ?? videoFiles[0];
  console.log(`Using video: ${videoFile}`);

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
  const url = `http://127.0.0.1:${port}/fullgame.html?rate=${playbackRate}&backend=cpu&video=${encodeURIComponent(`/fixture-video/${videoFile}`)}`;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccw-fullgame-"));
  remoteDebuggingPort = Number(
    process.env.CHROME_DEBUG_PORT ?? (await getFreePort()),
  );
  console.log(`Opening ${url}`);
  console.log(`Using browser debug port ${remoteDebuggingPort}`);

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
    if (text) console.error("Browser:", text);
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
      // browser may hold profile files briefly after exit
    }
  };

  try {
    console.log("Waiting for browser CDP endpoint...");
    const wsUrl = await waitForWebSocketUrl();
    console.log("Connected to browser CDP endpoint.");
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
        console.log(
          "Browser console:",
          args.map(arg => arg.value ?? arg.description).join(" "),
        );
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
