import "bootstrap/dist/css/bootstrap.min.css";
import { createRoot } from "react-dom/client";
import { useRef, useState, useCallback } from "react";
import "./style/index.css";
import Video from "./components/common/video";
import { START_FEN } from "./utils/constants";
import { makePgn } from "./slices/gameSlice";
import { Game } from "./types";

const piecesModelRef: any = { current: undefined };
const xcornersModelRef: any = { current: undefined };
const DEFAULT_VIDEO_URL = "/fixture-video/0509.mp4";
(globalThis as any).__CAMERA_CHESS_TF_BACKEND__ =
  new URLSearchParams(window.location.search).get("backend") ?? "cpu";

const makeGameFromPayload = (payload: any): Game => ({
  start: START_FEN,
  fen: payload?.fen ?? START_FEN,
  moves: payload?.moves ?? "",
  lastMove: payload?.lastMove ?? "",
  greedy: payload?.greedy ?? false,
  fromOpponent: payload?.fromOpponent ?? false,
  error: payload?.error ?? null,
});

const FullGameRunner = () => {
  const latestRef = useRef<any>({
    fen: START_FEN,
    moves: "",
    lastMove: "",
    error: null,
  });
  const [latest, setLatest] = useState<any>(latestRef.current);
  const [done, setDone] = useState(false);
  const videoUrl =
    new URLSearchParams(window.location.search).get("video") ??
    DEFAULT_VIDEO_URL;
  const playbackRate = Number(
    new URLSearchParams(window.location.search).get("rate") ?? "2",
  );

  const onMoveDetected = useCallback((payload: any) => {
    latestRef.current = payload;
    setLatest(payload);
    console.log("FULLGAME_UPDATE", payload);
  }, []);

  const onVideoEnded = useCallback(() => {
    setDone(true);
    const game = makeGameFromPayload(latestRef.current);
    const result = {
      status: "done",
      fen: game.fen,
      pgn: makePgn(game),
      moves: game.moves,
      lastMove: game.lastMove,
      error: game.error,
    };
    console.log("FULLGAME_RESULT", JSON.stringify(result));
  }, []);

  const pgn = makePgn(makeGameFromPayload(latest));

  return (
    <main style={{ minHeight: "100vh", background: "#111", color: "#fff" }}>
      <section style={{ height: "70vh", position: "relative" }}>
        <Video
          piecesModelRef={piecesModelRef}
          xcornersModelRef={xcornersModelRef}
          sourceUrl={videoUrl}
          playbackRate={playbackRate}
          onMoveDetected={onMoveDetected}
          onVideoEnded={onVideoEnded}
        />
      </section>
      <section style={{ padding: 16, fontFamily: "monospace" }}>
        <div id="status">{done ? "done" : "running"}</div>
        <div id="fen">{latest.fen}</div>
        <pre id="pgn" style={{ whiteSpace: "pre-wrap" }}>{pgn}</pre>
      </section>
    </main>
  );
};

createRoot(document.getElementById("root")!).render(<FullGameRunner />);
