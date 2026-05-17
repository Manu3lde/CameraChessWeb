import "bootstrap/dist/js/bootstrap.bundle.min.js";
import "bootstrap/dist/css/bootstrap.min.css";
import { createRoot } from "react-dom/client";
import { useCallback } from "react";
import "./style/index.css";
import Video from "./components/common/video";

const piecesModelRef: any = { current: undefined };
const xcornersModelRef: any = { current: undefined };

const App = () => {
  const onMoveDetected = useCallback((data: any) => {
    console.log("Move detected:", data);
  }, []);

  return (
    <Video
      piecesModelRef={piecesModelRef}
      xcornersModelRef={xcornersModelRef}
      onMoveDetected={onMoveDetected}
    />
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
