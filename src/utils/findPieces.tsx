import * as tf from "@tensorflow/tfjs-core";
import { parseSan } from "chessops/san";
import { makeUci } from "chessops/util";
import { makeUpdatePayload } from "../slices/gameSlice";
import { getBoxesAndScores, getInput, getXY, invalidVideo } from "./detect";
import { getMovesPairs } from "./moves";
import { getInvTransform, transformBoundary, transformCenters } from "./warp";
import { CORNER_KEYS } from "./constants";
import { renderState } from "./render/renderState";
import { MovesPair, MovesData, Mode } from "../types";

const zeros = (rows: number, cols: number): number[][] =>
  Array.from({ length: rows }, () => new Array(cols).fill(0));

const calculateScore = (state: number[][], movesData: MovesData): number => {
  let score = 0;
  for (let i = 0; i < movesData.from.length; i++) {
    score += state[movesData.from[i]][movesData.targets[i]];
  }
  for (let i = 0; i < movesData.to.length; i++) {
    score += state[movesData.to[i]][movesData.targets[i]];
  }
  return score;
};

const processState = (
  state: number[][],
  movesPairs: MovesPair[],
  possibleMoves: Set<string>,
): {
  bestScore1: number;
  bestScore2: number;
  bestJointScore: number;
  bestMove: MovesData | null;
  bestMoves: MovesData | null;
} => {
  let bestScore1 = Number.NEGATIVE_INFINITY;
  let bestScore2 = Number.NEGATIVE_INFINITY;
  let bestJointScore = Number.NEGATIVE_INFINITY;
  let bestMove: MovesData | null = null;
  let bestMoves: MovesData | null = null;
  const seen: Set<string> = new Set();

  movesPairs.forEach(movePair => {
    if (!seen.has(movePair.move1.sans[0])) {
      seen.add(movePair.move1.sans[0]);
      const score = calculateScore(state, movePair.move1);
      if (score > 0) {
        possibleMoves.add(movePair.move1.sans[0]);
      }
      if (score > bestScore1) {
        bestMove = movePair.move1;
        bestScore1 = score;
      }
    }

    if (
      movePair.move2 === null ||
      movePair.moves === null ||
      !possibleMoves.has(movePair.move1.sans[0])
    ) {
      return;
    }

    const score2: number = calculateScore(state, movePair.move2);
    if (score2 < 0) {
      return;
    } else if (score2 > bestScore2) {
      bestScore2 = score2;
    }

    const jointScore: number = calculateScore(state, movePair.moves);
    if (jointScore > bestJointScore) {
      bestJointScore = jointScore;
      bestMoves = movePair.moves;
    }
  });

  return { bestScore1, bestScore2, bestJointScore, bestMove, bestMoves };
};

const getBoxCenters = (boxes: tf.Tensor2D) => {
  const boxCenters: tf.Tensor2D = tf.tidy(() => {
    const l: tf.Tensor2D = tf.slice(boxes, [0, 0], [-1, 1]);
    const r: tf.Tensor2D = tf.slice(boxes, [0, 2], [-1, 1]);
    const b: tf.Tensor2D = tf.slice(boxes, [0, 3], [-1, 1]);
    const cx: tf.Tensor2D = tf.div(tf.add(l, r), 2);
    const cy: tf.Tensor2D = tf.sub(b, tf.div(tf.sub(r, l), 3));
    const boxCenters: tf.Tensor2D = tf.concat([cx, cy], 1);
    return boxCenters;
  });
  return boxCenters;
};

export const getSquares = (
  boxes: tf.Tensor2D,
  centers3D: tf.Tensor3D,
  _boundary3D: tf.Tensor3D,
): number[] => {
  const boxCenters = getBoxCenters(boxes);
  const diff = tf.tidy(() =>
    tf.abs(tf.sub(tf.expandDims(boxCenters, 1), centers3D)),
  ) as tf.Tensor3D;
  const dist: tf.Tensor2D = tf.tidy(
    () => tf.squeeze(tf.sum(diff, 2), []) as tf.Tensor2D,
  );
  const squaresTensor = tf.argMin(dist, 1);
  const squares = Array.from(squaresTensor.dataSync());
  tf.dispose([boxCenters, diff, dist, squaresTensor]);
  return squares;
};

export const getUpdate = (
  scores: tf.Tensor2D,
  squares: number[],
): number[][] => {
  const update = zeros(64, 12);
  const scoresData = scores.arraySync() as number[][];
  for (let i = 0; i < squares.length; i++) {
    const sq = squares[i];
    for (let j = 0; j < 12; j++) {
      update[sq][j] = Math.max(update[sq][j], scoresData[i][j]);
    }
  }
  return update;
};

const updateState = (
  state: number[][],
  update: number[][],
  decay: number = 0.5,
) => {
  for (let i = 0; i < 64; i++) {
    for (let j = 0; j < 12; j++) {
      state[i][j] = decay * state[i][j] + (1 - decay) * update[i][j];
    }
  }
  return state;
};

const sanToLan = (board: any, san: string): string => {
  const move = parseSan(board, san);
  if (!move) return "";
  return makeUci(move);
};

export const detect = async (
  modelRef: any,
  videoRef: any,
  keypoints: number[][],
): Promise<{ boxes: tf.Tensor2D; scores: tf.Tensor2D }> => {
  const { image4D, width, height, padding, roi } = getInput(
    videoRef,
    keypoints,
  );
  const videoWidth: number = videoRef.current.videoWidth;
  const videoHeight: number = videoRef.current.videoHeight;

  const preds: any = modelRef.current.execute(image4D);
  const { boxes, scores } = getBoxesAndScores(
    Array.isArray(preds) ? preds[0] : preds,
    width,
    height,
    videoWidth,
    videoHeight,
    padding,
    roi,
  );

  tf.dispose([image4D, preds]);

  return { boxes, scores };
};

export const getKeypoints = (cornersRef: any, canvasRef?: any): number[][] => {
  // When canvasRef is supplied (findFen path), cornersRef.current holds marker-space
  // coords that need getXY() to convert to model-space.
  // When called from the findPieces loop, cornersRef.current already holds
  // model-space coords set directly by findCorners → no conversion needed.
  if (canvasRef) {
    return CORNER_KEYS.map(x =>
      getXY(
        cornersRef.current[x],
        canvasRef.current.height,
        canvasRef.current.width,
      ),
    );
  }
  return CORNER_KEYS.map(x => cornersRef.current[x]);
};

export const findPieces = (
  modelRef: any,
  videoRef: any,
  canvasRef: any,
  playingRef: any,
  setText: any,
  cornersRef: any,
  boardRef: any,
  movesPairsRef: any,
  lastMoveRef: any,
  moveTextRef: any,
  mode: Mode,
  onUpdate?: (data: any) => void,
) => {
  let centers: number[][] | null = null;
  let boundary: number[][];
  let centers3D: tf.Tensor3D | null = null;
  let boundary3D: tf.Tensor3D | null = null;
  let state: number[][];
  let keypoints: number[][];
  let possibleMoves: Set<string>;
  // Use a number for setTimeout handle (works in both browser and Node environments)
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let greedyMoveToTime: { [move: string]: number };

  const loop = async () => {
    if (stopped) return;

    try {
      if (playingRef.current === false || invalidVideo(videoRef)) {
        if (centers3D) {
          tf.dispose([centers3D, boundary3D].filter(Boolean) as tf.Tensor[]);
          centers3D = null;
          boundary3D = null;
        }
        centers = null;
      } else {
        if (centers === null) {
          keypoints = getKeypoints(cornersRef);
          // If any corner is still undefined (corners not yet detected), skip this frame
          if (keypoints.some(k => k === undefined || k === null)) {
            timeoutId = setTimeout(loop, 0);
            return;
          }
          const invTransform = getInvTransform(keypoints);
          [centers, centers3D] = transformCenters(invTransform);
          [boundary, boundary3D] = transformBoundary(invTransform);
          state = zeros(64, 12);
          possibleMoves = new Set<string>();
          greedyMoveToTime = {};
        }
        const startTime: number = performance.now();
        const startTensors: number = tf.memory().numTensors;

        const { boxes, scores } = await detect(modelRef, videoRef, keypoints);
        // centers3D and boundary3D are guaranteed non-null here
        const squares: number[] = getSquares(boxes, centers3D!, boundary3D!);
        const update: number[][] = getUpdate(scores, squares);
        state = updateState(state, update);
        const { bestScore1, bestScore2, bestJointScore, bestMove, bestMoves } =
          processState(state, movesPairsRef.current, possibleMoves);

        const endTime: number = performance.now();
        const fps: string = (1000 / (endTime - startTime)).toFixed(1);

        let hasMove: boolean = false;
        if (bestMoves !== null && mode !== "play") {
          const move: string = bestMoves.sans[0];
          hasMove =
            bestScore2 > 0 && bestJointScore > 0 && possibleMoves.has(move);
          if (hasMove) {
            boardRef.current.playSan(move);
            possibleMoves.clear();
            greedyMoveToTime = {};
          }
        }

        let hasGreedyMove: boolean = false;
        if (bestMove !== null && !hasMove && bestScore1 > 0) {
          const move: string = bestMove.sans[0];
          if (!(move in greedyMoveToTime)) {
            greedyMoveToTime[move] = endTime;
          }

          // Scale the greedy confirmation window by how fast inference is running.
          // On CPU backend one loop iteration often takes >500 ms; waiting a full
          // wall-clock second before confirming a greedy move means we effectively
          // skip it. Use the larger of 1 s and 3× the current frame time instead.
          const frameMs = endTime - startTime;
          const confirmMs = Math.max(1000, frameMs * 3);
          const secondElapsed = endTime - greedyMoveToTime[move] > confirmMs;
          const newMove =
            sanToLan(boardRef.current, move) !== lastMoveRef.current;
          hasGreedyMove = secondElapsed && newMove;
          if (hasGreedyMove) {
            boardRef.current.playSan(move);
            greedyMoveToTime = {};
          }
        }

        if (hasMove || hasGreedyMove) {
          const greedy = mode === "play" ? false : hasGreedyMove;
          const payload = makeUpdatePayload(boardRef.current, greedy);

          // Update tracking refs so the next frame uses the correct legal moves
          movesPairsRef.current = getMovesPairs(boardRef.current);
          lastMoveRef.current = payload.lastMove;

          console.log("payload", payload);
          if (onUpdate) {
            onUpdate({
              fen: payload.fen,
              lastMove: payload.lastMove,
              isCheck: boardRef.current.isCheck?.() ?? false,
              moves: payload.moves,
              greedy: payload.greedy,
              fromOpponent: payload.fromOpponent,
              error: payload.error ?? null,
            });
          }
        }
        setText([`FPS: ${fps}`, moveTextRef.current]);

        renderState(canvasRef.current, centers, boundary, state);

        tf.dispose([boxes, scores]);

        const endTensors: number = tf.memory().numTensors;
        if (startTensors < endTensors) {
          console.error(`Memory Leak! (${endTensors} > ${startTensors})`);
        }
      }
    } catch (err) {
      console.error("findPieces loop error:", err);
    }

    if (!stopped) {
      // Use setTimeout(0) instead of requestAnimationFrame so the browser's
      // video decoder and event loop can advance between inference frames.
      // rAF in --headless=new --disable-gpu mode is throttled and can prevent
      // the video element from delivering new frames (stalls currentTime).
      timeoutId = setTimeout(loop, 0);
    }
  };

  // Kick off the first iteration
  timeoutId = setTimeout(loop, 0);

  return () => {
    stopped = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (centers3D) {
      tf.dispose([centers3D, boundary3D].filter(Boolean) as tf.Tensor[]);
    }
  };
};
