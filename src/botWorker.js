// src/botWorker.js
// Web Worker AI: uses ChessGame rules, minimax with alpha-beta pruning + iterative deepening.

import { ChessGame, BOARD_ROWS, BOARD_COLS, RIVER_ROW_INDEX } from "./game";

// Piece values
const PIECE_VALUES = {
  p: 70, r: 500, n: 320, b: 330, q: 900, k: 20000, h: 700,
  xs: 70, xr: 500, xn: 320, xb: 330, xa: 200, xg: 20000, xc: 450,
};

// --- Helpers ---
function getPieceColor(token) {
  if (!token || token === " ") return null;
  return token === token.toUpperCase() ? "w" : "b";
}

function boardKey(board, turn, depth, maximizing) {
  return JSON.stringify(board) + "|" + turn + "|d" + depth + "|m" + (maximizing ? 1 : 0);
}

function normalizeBoard(boardState) {
  return boardState.map(row => row.map(cell => (cell == null ? " " : String(cell))));
}

function countPositionOccurrences(board, positionHistory, turn) {
  if (!positionHistory || typeof positionHistory !== "object") return 0;

  const temp = new ChessGame();
  temp.board = normalizeBoard(board);
  temp.turn = turn;
  const fenKey = temp._generateBoardFEN();

  return positionHistory[fenKey] || 0;
}

function evaluateBoard(boardState, botColor) {
  let score = 0;

  for (let r = 0; r < BOARD_ROWS; r++) {
    for (let c = 0; c < BOARD_COLS; c++) {
      const token = boardState[r][c];
      if (!token || token === " ") continue;

      const normalizedPiece = token.toLowerCase();
      const base = PIECE_VALUES[ normalizedPiece] || 0;
      let pieceScore = base;
      const color = getPieceColor(token);

      // Pawn/Soldier advancement
      if (normalizedPiece === "p" && color === "b" && r > RIVER_ROW_INDEX) pieceScore += 30;
      if (normalizedPiece === "xs" && color === "w" && r < RIVER_ROW_INDEX) pieceScore += 30;

      // King/General safety
      if (normalizedPiece === "k") {
        if (!(r >= 0 && r <= 4)) pieceScore -= 200;
      }
      if (normalizedPiece === "xg") {
        const inPalace = r >= 8 && r <= 10 && c >= 3 && c <= 5;
        if (!inPalace) pieceScore -= 200;
      }

      score += color === botColor ? pieceScore : -pieceScore;
    }
  }

  // Mobility bonus
  try {
    const tmp = new ChessGame();
    tmp.board = normalizeBoard(boardState);
    const botMoves = tmp.getLegalMoves(botColor).length;
    const opp = botColor === "w" ? "b" : "w";
    const oppMoves = tmp.getLegalMoves(opp).length;
    score += (botMoves - oppMoves) * 3;
  } catch (e) {
    console.warn("[Worker] Mobility eval skipped:", e.message);
  }

  return score;
}

function applyMove(board, move) {
  const newBoard = board.map(row => [...row]);
  const piece = newBoard[move.from.r][move.from.c];

  // Check for pawn promotion
  if (piece.toLowerCase() === 'p' && move.to.r === 0) {
    // Promote black pawn to queen
    newBoard[move.to.r][move.to.c] = 'q';
  } else if (piece.toLowerCase() === 'xs' && move.to.r === BOARD_ROWS - 1) {
    // Promote white pawn/soldier to chariot/rook (XR)
    newBoard[move.to.r][move.to.c] = 'XR';
  } else {
    // Standard move
    newBoard[move.to.r][move.to.c] = newBoard[move.from.r][move.from.c];
  }

  newBoard[move.from.r][move.from.c] = " ";
  return newBoard;
}

function captureValue(move, board) {
  const target = board[move.to.r][move.to.c];
  if (!target || target === " ") return 0;
  return PIECE_VALUES[String(target).toLowerCase()] || 0;
}

// --- Minimax with Alpha-Beta ---
let TT = new Map();
let nodesSearched = 0;

function minimax(board, depth, alpha, beta, maximizing, botColor, deadline, boardHistory, positionHistory) {
  nodesSearched++;
  if (performance.now() > deadline) throw new Error("TIMEOUT");

  // Check for three-fold repetition and assign a draw-like score
  const currentTurn = maximizing ? botColor : (botColor === "w" ? "b" : "w");
  if (countPositionOccurrences(board, positionHistory, currentTurn) >= 2) {
  return 0;
  }

  const current = maximizing ? botColor : botColor === "w" ? "b" : "w";
  const key = boardKey(board, current, depth, maximizing);
  if (TT.has(key)) return TT.get(key);

  const game = new ChessGame();
  game.board = normalizeBoard(board);
  game.turn = current;

  if (depth === 0 || game.isGameOver()) {
    const val = evaluateBoard(board, botColor);
    TT.set(key, val);
    return val;
  }

  const moves = game.getLegalMoves(current);
  if (!moves || moves.length === 0) {
    const val = evaluateBoard(board, botColor);
    TT.set(key, val);
    return val;
  }

  moves.sort((a, b) => captureValue(b, board) - captureValue(a, board));

  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      const next = applyMove(board, m);
      const val = minimax(next, depth - 1, alpha, beta, false, botColor, deadline, positionHistory);
      best = Math.max(best, val);
      alpha = Math.max(alpha, val);
      if (beta <= alpha) break;
    }
    TT.set(key, best);
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      const next = applyMove(board, m);
      const val = minimax(next, depth - 1, alpha, beta, true, botColor, deadline, positionHistory);
      best = Math.min(best, val);
      beta = Math.min(beta, val);
      if (beta <= alpha) break;
    }
    TT.set(key, best);
    return best;
  }
}

// Iterative deepening wrapper
function iterativeDeepening(board, rootMoves, color, maxDepth, timeLimitMs, positionHistory) {
  const start = performance.now();
  const deadline = start + timeLimitMs;

  let best = null;
  let bestScore = -Infinity;

  rootMoves = rootMoves && rootMoves.length
    ? rootMoves
    : (() => {
        const g = new ChessGame();
        g.board = normalizeBoard(board);
        g.turn = color;
        return g.getLegalMoves(color);
      })();

  if (!rootMoves || !rootMoves.length) return null;

  rootMoves.sort((a, b) => captureValue(b, board) - captureValue(a, board));

  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      TT.clear();
      nodesSearched = 0;
      let currentBest = null;
      let currentBestScore = -Infinity;

      for (const m of rootMoves) {
        const next = applyMove(board, m);
        const val = minimax(next, depth - 1, -Infinity, Infinity, false, color, deadline, positionHistory);
        if (val > currentBestScore) {
          currentBestScore = val;
          currentBest = m;
        }
      }

      best = currentBest;
      bestScore = currentBestScore;
      console.log(`[Worker] Depth ${depth} finished. nodes=${nodesSearched}, score=${bestScore}`);
    } catch (err) {
      if (err.message === "TIMEOUT") {
        console.log("[Worker] Iterative deepening stopped at depth", depth);
        break;
      } else {
        throw err;
      }
    }
  }

  return {
    from: best.from,
    to: best.to,
    score: bestScore,
  };
}

// --- Worker entrypoint ---
onmessage = (ev) => {
  try {
    const data = ev.data || {};
    console.log("[Worker] onmessage payload keys:", Object.keys(data));
    console.log("[Worker] payload preview:", {
      color: data.color,
      searchDepth: data.searchDepth,
      rootMovesLen: Array.isArray(data.legalMoves) ? data.legalMoves.length : 0,
      boardRows: Array.isArray(data.boardState) ? data.boardState.length : 0,
      boardHistoryLen: Array.isArray(data.boardHistory) ? data.boardHistory.length : 0
    });

    if (!Array.isArray(data.boardState)) throw new Error("boardState must be an array of rows");
    if (!Array.isArray(data.boardState[0])) throw new Error("boardState rows must be arrays");

    const board = normalizeBoard(data.boardState);
    const rootMoves = data.legalMoves || [];

    const result = iterativeDeepening(board, rootMoves, data.color, data.searchDepth || 3, data.timeLimit || 5000, data.positionHistory || {});
    postMessage(result || null);

  } catch (err) {
    console.error("[Worker] Fatal error:", err);
    postMessage({ __error: err.message || String(err) });
  }
};