import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import VideoProcessor from "../components/common/video";
import LoadModels from "../utils/loadModels";
import * as findCornersModule from "../utils/findCorners";
import * as findPiecesModule from "../utils/findPieces";
import { VIDEO_FIXTURE_URL } from "./setup";

describe("CameraChessWeb Headless Engine", () => {
  it("processes the first video frame after models are loaded", async () => {
    const observedModelRefs: any[] = [];
    vi.mocked(LoadModels).mockImplementationOnce(
      async (piecesModelRef: any, xcornersModelRef: any) => {
        await new Promise(resolve => setTimeout(resolve, 0));
        piecesModelRef.current = { name: "loaded-pieces-model" };
        xcornersModelRef.current = { name: "loaded-xcorners-model" };
      },
    );
    vi.mocked(findCornersModule.findCorners).mockImplementationOnce(
      async (...args: any[]) => {
        const piecesModelRef = args[0];
        const xcornersModelRef = args[1];
        const onCornersFound = args[6];
        observedModelRefs.push({
          pieces: piecesModelRef.current,
          xcorners: xcornersModelRef.current,
        });
        if (typeof onCornersFound === "function") {
          onCornersFound({
            a1: [0, 0],
            h1: [480, 0],
            h8: [480, 480],
            a8: [0, 480],
          });
        }
        return () => {};
      },
    );

    const onUpdateMock = vi.fn();
    const piecesModelRef = { current: undefined };
    const xcornersModelRef = { current: undefined };
    const { container } = render(
      <VideoProcessor
        piecesModelRef={piecesModelRef}
        xcornersModelRef={xcornersModelRef}
        onMoveDetected={onUpdateMock}
      />,
    );

    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video).toBeInstanceOf(HTMLVideoElement);

    await waitFor(() => expect(onUpdateMock).toHaveBeenCalled(), {
      timeout: 5000,
    });
    expect(video.src).toBe(VIDEO_FIXTURE_URL);
    expect(observedModelRefs).toEqual([
      {
        pieces: { name: "loaded-pieces-model" },
        xcorners: { name: "loaded-xcorners-model" },
      },
    ]);

    const payload = onUpdateMock.mock.calls[0][0];

    console.log("Live FEN output:", payload.fen);
    console.log("Live PGN output:", payload.moves);

    expect(payload).toMatchObject({
      fen: expect.any(String),
      lastMove: expect.any(String),
      moves: expect.any(String),
      error: null,
    });

    const fenRegex =
      /^([rnbqkpRNBQKP1-8]+\/){7}([rnbqkpRNBQKP1-8]+) [bw] (-|[KkQq]+) (-|[a-h][36]) \d+ \d+$/;
    expect(payload.fen).toMatch(fenRegex);
    expect(payload.fen).toBe(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    );
    expect(payload.moves).toBe("");
  });

  it("handles detection errors gracefully", async () => {
    const mockFindPieces = vi.mocked(findPiecesModule.findPieces);
    mockFindPieces.mockImplementationOnce((...args: any[]) => {
      const onMoveDetected = args[args.length - 1];
      if (typeof onMoveDetected === "function") {
        queueMicrotask(() => {
          onMoveDetected({
            fen: "",
            lastMove: "",
            moves: "",
            error: "Inference Failed",
          });
        });
      }
      return () => {};
    });

    const onUpdateMock = vi.fn();
    const piecesModelRef = { current: undefined };
    const xcornersModelRef = { current: undefined };
    const { container } = render(
      <VideoProcessor
        piecesModelRef={piecesModelRef}
        xcornersModelRef={xcornersModelRef}
        onMoveDetected={onUpdateMock}
      />,
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    video.dispatchEvent(new Event("loadedmetadata"));

    await waitFor(() =>
      expect(onUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("Inference"),
        }),
      ),
    );
  });
});
