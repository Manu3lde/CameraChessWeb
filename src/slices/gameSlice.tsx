import { Game } from '../types';
import { START_FEN } from '../utils/constants';
import { parseFen, makeFen } from 'chessops/fen';
import { Move } from 'chessops';
import { Chess } from 'chessops/chess';
import { parsePgn } from 'chessops/pgn';
import { parseSan, makeSan } from 'chessops/san';
import { makeUci, parseUci } from 'chessops/util';

type HistoryEntry = { move: Move; san: string };

const getMovesFromPgn = (pos: any, startFen: string) => {
  const setup = parseFen(startFen).unwrap();
  const tempPos = Chess.fromSetup(setup).unwrap();
  const history = pos.history as HistoryEntry[] || [];

  let pgn = "";
  history.forEach((entry: HistoryEntry) => {
    if (tempPos.turn === 'white') {
      pgn += `${tempPos.fullmoves}. `;
    }
    pgn += `${entry.san} `;
    tempPos.play(entry.move);
  });
  return pgn.trim();
}

export const makePgn = (game: Game) => {
  return `[FEN "${game.start}"]` + "\n \n" + game.moves;
}

export const makeUpdatePayload = (board: any, greedy: boolean = false, fromOpponent: boolean = false, error: string | null = null) => {
  const history = board.history as HistoryEntry[] || [];
  const startFen = board.startFen || START_FEN;

  const moves = getMovesFromPgn(board, startFen);
  const fen = makeFen(board.toSetup());
  const lastMove = (history.length === 0) ? "" : makeUci(history[history.length - 1].move);

  const payload = {
    "moves": moves,
    "fen": fen,
    "lastMove": lastMove,
    "greedy": greedy,
    "fromOpponent": fromOpponent,
    "error": error
  }

  return payload
}

export const makeBoard = (game: Game): any => {
  const setup = parseFen(game.start).unwrap();
  const board: any = Chess.fromSetup(setup).unwrap();
  board.startFen = game.start;
  board.history = [] as HistoryEntry[];

  const updateFromHistory = () => {
    const freshSetup = parseFen(board.startFen).unwrap();
    const freshBoard = Chess.fromSetup(freshSetup).unwrap();
    board.board = freshBoard.board;
    board.turn = freshBoard.turn;
    board.castles = freshBoard.castles;
    board.epSquare = freshBoard.epSquare;
    board.halfmoves = freshBoard.halfmoves;
    board.fullmoves = freshBoard.fullmoves;

    board.history.forEach((entry: HistoryEntry) => board.play(entry.move));
  };

  board.playSan = (san: string) => {
    const move = parseSan(board, san);
    if (move) {
      const entry: HistoryEntry = { move: move as Move, san };
      board.history.push(entry);
      board.play(move);
      return move;
    }
    return null;
  };

  board.playUci = (uci: string) => {
    const move = parseUci(uci);
    if (move) {
      const san = makeSan(board, move);
      const entry: HistoryEntry = { move, san };
      board.history.push(entry);
      board.play(move);
      return move;
    }
    return null;
  };

  board.undo = () => {
    if (board.history.length > 0) {
      board.history.pop();
      updateFromHistory();
    }
  };

  const games = parsePgn(game.moves);
  if (games.length > 0) {
    for (const node of games[0].moves.mainline()) {
      board.playSan(node.san);
    }
  }
  return board;
}