import "bootstrap/dist/js/bootstrap.bundle.min.js";
import "bootstrap/dist/css/bootstrap.min.css";
import { createRoot } from "react-dom/client";
import "./style/index.css";
import Video from "./components/common/video";

const piecesModelRef: any = { current: undefined };
const xcornersModelRef: any = { current: undefined };

const root = createRoot(document.getElementById("root")!);
root.render(
  <Video
    piecesModelRef={piecesModelRef}
    xcornersModelRef={xcornersModelRef}
    onMoveDetected={data => {
      console.log("Move detected:", data);
    }}
  />,
);
