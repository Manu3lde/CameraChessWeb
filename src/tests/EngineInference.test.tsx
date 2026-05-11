import { render, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import VideoProcessor from "../components/common/video";
import * as findPiecesModule from "../utils/findPieces";

describe("CameraChessWeb Headless Engine", () => {
  it("processes video input and emits a valid FEN/Move payload", async () => {
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

    video.dispatchEvent(new Event("loadedmetadata"));

    await waitFor(() => expect(onUpdateMock).toHaveBeenCalled(), {
      timeout: 5000,
    });

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
