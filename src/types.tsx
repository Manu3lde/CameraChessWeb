interface ModelRefs {
  piecesModelRef: any,
  xcornersModelRef: any
}

interface MovesData {
  sans: string[],
  from: number[],
  to: number[],
  targets: number[]
}
interface MovesPair {
  "move1": MovesData,
  "move2": MovesData | null,
  "moves": MovesData | null
}

type CornersKey = "h1" | "a1" | "a8" | "h8"; 
interface CornersPayload {
  key: CornersKey,
  xy: number[]
}
type CornersDict = {[key in CornersKey]: number[]};

interface Game {
  fen: string,
  moves: string,
  start: string,
  lastMove: string,
  greedy: boolean,
  fromOpponent: boolean,
  error: string | null
}

type Mode = "record" | "upload" | "broadcast" | "play";

type SetBoolean = React.Dispatch<React.SetStateAction<boolean>>
type SetString = React.Dispatch<React.SetStateAction<string>>
type SetStringArray = React.Dispatch<React.SetStateAction<string[]>>
type SetNumber = React.Dispatch<React.SetStateAction<number>>

export type { 
  ModelRefs, MovesData, MovesPair, 
  CornersDict, CornersKey, CornersPayload, Game,
  SetBoolean, SetString, SetStringArray, SetNumber, Mode
}