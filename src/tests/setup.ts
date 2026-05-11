import { vi } from "vitest";

// Mock Camera API to use pre-recorded video instead
Object.defineProperty(global.navigator, "mediaDevices", {
  value: {
    getUserMedia: vi.fn(() =>
      Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] }),
    ),
  },
});

Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
  value: vi.fn(() => Promise.resolve()),
  configurable: true,
});

Object.defineProperty(window.HTMLMediaElement.prototype, "pause", {
  value: vi.fn(),
  configurable: true,
});

// Mock video element to use pre-recorded video file
const originalAddEventListener = HTMLVideoElement.prototype.addEventListener;
Object.defineProperty(HTMLVideoElement.prototype, "addEventListener", {
  value: function (type: string, listener: any, options?: any) {
    if (type === "loadedmetadata" && typeof listener === "function") {
      // Set src to pre-recorded video before triggering loadedmetadata
      if (this.tagName === "VIDEO" && !this.src) {
        this.src = "../../../video/0509.mp4";
      }
      queueMicrotask(() => listener(new Event("loadedmetadata")));
    }
    return originalAddEventListener.call(this, type, listener, options);
  },
  configurable: true,
});

// Mock srcObject to set src instead for video files
Object.defineProperty(HTMLVideoElement.prototype, "srcObject", {
  set: function (value) {
    // Instead of setting srcObject, set src to the pre-recorded video
    this.src = "../../../video/0509.mp4";
  },
  configurable: true,
});

Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
  get: () => 640,
  configurable: true,
});

Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
  get: () => 360,
  configurable: true,
});

vi.mock("../utils/loadModels", () => ({
  __esModule: true,
  default: vi.fn(),
}));

vi.mock("../utils/findCorners", () => ({
  findCorners: vi.fn(
    async (
      _piecesModelRef: any,
      _xcornersModelRef: any,
      _videoRef: any,
      _canvasRef: any,
      _dispatch: any,
      _setText: any,
      onCornersFound: any,
    ) => {
      if (typeof onCornersFound === "function") {
        onCornersFound({
          a1: [0, 0],
          h1: [480, 0],
          h8: [480, 480],
          a8: [0, 480],
        });
      }
    },
  ),
}));

vi.mock("../utils/findPieces", () => ({
  findPieces: vi.fn((...args: any[]) => {
    const onMoveDetected = args[args.length - 1];
    if (typeof onMoveDetected === "function") {
      queueMicrotask(() => {
        onMoveDetected({
          fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
          lastMove: "",
          moves: "",
          error: null,
        });
      });
    }
    return () => {};
  }),
}));
