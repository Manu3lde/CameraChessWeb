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

        const video = videoRef.current;
        if (!video) return undefined;

        if (sourceUrl) {
          video.src = sourceUrl;
          // We manage play() ourselves below
          video.autoplay = false;
        } else {
          const stream =
            await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS);
          video.srcObject = stream;
        }
        video.playbackRate = playbackRate;

        // Wait for metadata — guard against the race where readyState is already ≥ 1
        if (video.readyState < 1 /* HAVE_METADATA */) {
          await new Promise<void>((resolve, reject) => {
            const onMetadata = () => {
              video.removeEventListener("loadedmetadata", onMetadata);
              video.removeEventListener("error", onError);
              resolve();
            };
            const onError = (e: Event) => {
              video.removeEventListener("loadedmetadata", onMetadata);
              video.removeEventListener("error", onError);
              reject(
                new Error(
                  `Video load error: ${(e as ErrorEvent).message ?? "unknown"}`,
                ),
              );
            };
            video.addEventListener("loadedmetadata", onMetadata);
            video.addEventListener("error", onError);
          });
        }

        // Sync canvas dimensions to video
        if (canvasRef.current) {
          canvasRef.current.width = video.videoWidth;
          canvasRef.current.height = video.videoHeight;
        }

        // Wait until enough data is buffered to decode a frame
        if (video.readyState < 3 /* HAVE_FUTURE_DATA */) {
          await new Promise<void>(resolve => {
            const onCanPlay = () => {
              video.removeEventListener("canplay", onCanPlay);
              resolve();
            };
            video.addEventListener("canplay", onCanPlay);
          });
        }

        // Start playback then immediately pause to get a stable decoded frame for findCorners
        await video.play();
        video.pause();

        // Try to find corners at a few seek positions — the first frame might be
        // a bad angle, motion-blurred, or otherwise undetectable
        let cornersFound = false;
        const seekOffsets = [0, 0.5, 1.0]; // seconds
        for (const offset of seekOffsets) {
          if (offset > 0 && video.duration && Number.isFinite(video.duration)) {
            video.currentTime = Math.min(offset, video.duration - 0.1);
            await new Promise<void>(resolve => {
              const onSeeked = () => {
                video.removeEventListener("seeked", onSeeked);
                resolve();
              };
              video.addEventListener("seeked", onSeeked);
            });
          }

          await findCorners(
            piecesModelRef,
            xcornersModelRef,
            videoRef,
            canvasRef,
            null,
            () => {},
            (corners: any) => {
              cornersRef.current = corners;
              cornersFound = true;
            },
          );

          if (cornersFound) {
            console.log(
              `findCorners: detected board corners at offset ${offset}s`,
            );
            break;
          }
          console.warn(
            `findCorners: no corners at offset ${offset}s, retrying...`,
          );
        }

        if (!cornersFound) {
          console.warn(
            "findCorners: could not detect board corners after retries — " +
              "using default corners; detection quality may be reduced.",
          );
        }

        // Seek back to start and resume normal playback
        video.currentTime = 0;
        await new Promise<void>(resolve => {
          const onSeeked = () => {
            video.removeEventListener("seeked", onSeeked);
            resolve();
          };
          video.addEventListener("seeked", onSeeked);
        });
        video.playbackRate = playbackRate;
        await video.play();

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
        video.addEventListener("ended", handleEnded);

        return () => {
          playingRef.current = false;
          cleanupFindPieces?.();
          video.removeEventListener("ended", handleEnded);
          if (video.srcObject) {
            const tracks = (video.srcObject as MediaStream).getTracks();
            tracks.forEach(track => track.stop());
          }
        };
      } catch (error) {
        console.error("Video initialization failed", error);
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
