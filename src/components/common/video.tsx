import { useEffect, useRef } from "react";
import LoadModels from "../../utils/loadModels";
import { findPieces } from "../../utils/findPieces";
import { findCorners } from "../../utils/findCorners";
import { getMovesPairs } from "../../utils/moves";
import { makeBoard } from "../../slices/gameSlice";
import { MEDIA_CONSTRAINTS, START_FEN } from "../../utils/constants";
import { MovesPair } from "../../types";

const Video = ({
  piecesModelRef,
  xcornersModelRef,
  onMoveDetected,
  sourceUrl,
  playbackRate = 1,
  onVideoEnded,
}: {
  piecesModelRef: any;
  xcornersModelRef: any;
  onMoveDetected?: (data: any) => void;
  sourceUrl?: string;
  playbackRate?: number;
  onVideoEnded?: () => void;
}) => {
  const videoRef = useRef<any>(null);
  const canvasRef = useRef<any>(null);
  const playingRef = useRef<boolean>(true);
  const cornersRef = useRef<any>({
    a1: [0, 0],
    h1: [480, 0],
    h8: [480, 480],
    a8: [0, 480],
  });
  const boardRef = useRef<any>(
    makeBoard({
      fen: START_FEN,
      start: START_FEN,
      moves: "",
      lastMove: "",
      greedy: false,
      fromOpponent: false,
      error: null,
    }),
  );
  const movesPairsRef = useRef<MovesPair[]>(getMovesPairs(boardRef.current));
  const lastMoveRef = useRef<string>("");
  const moveTextRef = useRef<string>("");

  useEffect(() => {
    const initialize = async () => {
      try {
        await LoadModels(piecesModelRef, xcornersModelRef);

        if (videoRef.current) {
          if (sourceUrl) {
            videoRef.current.src = sourceUrl;
            videoRef.current.autoplay = false;
          } else {
            const stream =
              await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS);
            videoRef.current.srcObject = stream;
          }
          videoRef.current.playbackRate = playbackRate;
        }

        await new Promise<void>(resolve => {
          const onMetadata = () => {
            if (videoRef.current && canvasRef.current) {
              canvasRef.current.width = videoRef.current.videoWidth;
              canvasRef.current.height = videoRef.current.videoHeight;
            }
            videoRef.current?.removeEventListener("loadedmetadata", onMetadata);
            resolve();
          };
          videoRef.current?.addEventListener("loadedmetadata", onMetadata);
        });

        await videoRef.current?.play();

        await findCorners(
          piecesModelRef,
          xcornersModelRef,
          videoRef,
          canvasRef,
          null,
          () => {},
          (corners: any) => {
            cornersRef.current = corners;
          },
        );

        const cleanupFindPieces = findPieces(
          piecesModelRef,
          videoRef,
          canvasRef,
          playingRef,
          () => {},
          cornersRef,
          boardRef,
          movesPairsRef,
          lastMoveRef,
          moveTextRef,
          "record",
          onMoveDetected,
        );

        const handleEnded = () => {
          playingRef.current = false;
          onVideoEnded?.();
        };
        videoRef.current?.addEventListener("ended", handleEnded);

        return () => {
          cleanupFindPieces?.();
          videoRef.current?.removeEventListener("ended", handleEnded);
          if (videoRef.current?.srcObject) {
            const tracks = (
              videoRef.current.srcObject as MediaStream
            ).getTracks();
            tracks.forEach(track => track.stop());
          }
        };
      } catch (error) {
        console.error("Camera initialization failed", error);
        return undefined;
      }
    };

    const cleanupPromise = initialize();
    return () => {
      cleanupPromise
        .then((cleanup: any) => cleanup && cleanup())
        .catch(() => undefined);
    };
  }, [
    piecesModelRef,
    xcornersModelRef,
    onMoveDetected,
    sourceUrl,
    playbackRate,
    onVideoEnded,
  ]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: "100%",
          height: "100%",
        }}
      />
    </div>
  );
};

export default Video;
