// game.js
// Self-contained game engine (extracted from your App.js).
// Exporting ChessGame and board constants so App.js and the worker can share the same rules.

export const BOARD_COLS = 9;   // 9 columns
export const BOARD_ROWS = 11;  // 11 rows
export const RIVER_ROW_INDEX = 5; // row index of the "river" (0-indexed)

class ChessGame {
  constructor() {
    // Initialize empty board with BOARD_ROWS x BOARD_COLS
    this.board = Array(BOARD_ROWS).fill(null).map(() => Array(BOARD_COLS).fill(' '));

    // Place black pieces (standard chess pieces) on top
    this.board[0] = ['r', 'n', 'b', 'q', 'k', 'h', 'b', 'n', 'r'];
    // Row 1: pawns in alternating columns (0,2,4,6,8)
    this.board[1][0] = 'p';
    this.board[1][2] = 'p';
    this.board[1][4] = 'p';
    this.board[1][6] = 'p';
    this.board[1][8] = 'p';

    // Place white Xiangqi pieces (bottom rows)
    // Row 10: XR XN XB XA XG XA XB XN XR
    this.board[10][0] = 'XR';
    this.board[10][1] = 'XN';
    this.board[10][2] = 'XB';
    this.board[10][3] = 'XA';
    this.board[10][4] = 'XG';
    this.board[10][5] = 'XA';
    this.board[10][6] = 'XB';
    this.board[10][7] = 'XN';
    this.board[10][8] = 'XR';

    // White Soldiers (XS) on row 7 (light squares 0,2,4,6,8)
    this.board[7][0] = 'XS';
    this.board[7][2] = 'XS';
    this.board[7][4] = 'XS';
    this.board[7][6] = 'XS';
    this.board[7][8] = 'XS';
    // White cannons
    this.board[8][1] = 'XC';
    this.board[8][7] = 'XC';

    // Game state
    this.turn = 'w'; // 'w' = white (Xiangqi side), 'b' = black (chess side)
    this.statusMessage = 'White to move';
    this.pendingPromotion = null; // Store pending promotion square + color
    this.promotedSoldierPositions = new Set(); // Tracks positions of white soldiers that have promoted to prevent re-promotion.
    this.isGameOverFlag = false;

    this.halfMoveClock = 0; // for fifty-move rule
    this.positionHistory = {}; // for threefold repetition
    this.boardHistory = [];
    this.boardHistory.push(this.board.map(row => [...row]));
    this._updatePositionHistory();
  }

  // Determine piece color
  getPieceColor(pieceChar) {
    if (!pieceChar || pieceChar === ' ') return null;
    const whitePieces = ['XR', 'XN', 'XB', 'XA', 'XG', 'XC', 'XS'];
    if (whitePieces.includes(pieceChar)) return 'w';
    const blackPieces = ['r', 'n', 'b', 'q', 'k', 'p', 'h'];
    if (blackPieces.includes(pieceChar)) return 'b';
    return null;
  }

  // --- Low-level move validators used by piece types ---
  _isRookMove(boardState, fromRow, fromCol, toRow, toCol) {
    if (fromRow === toRow) { // horizontal
      const step = fromCol < toCol ? 1 : -1;
      for (let col = fromCol + step; col !== toCol; col += step) {
        if (boardState[fromRow][col] !== ' ') return false;
      }
      return true;
    }
    if (fromCol === toCol) { // vertical
      const step = fromRow < toRow ? 1 : -1;
      for (let row = fromRow + step; row !== toRow; row += step) {
        if (boardState[row][fromCol] !== ' ') return false;
      }
      return true;
    }
    return false;
  }

  _isKnightMove(boardState, fromRow, fromCol, toRow, toCol) {
    const rowDiff = Math.abs(fromRow - toRow);
    const colDiff = Math.abs(fromCol - toCol);
    return (rowDiff === 1 && colDiff === 2) || (rowDiff === 2 && colDiff === 1);
  }

  _isBishopMove(boardState, fromRow, fromCol, toRow, toCol) {
    const rowDiff = Math.abs(fromRow - toRow);
    const colDiff = Math.abs(fromCol - toCol);

    if (rowDiff === colDiff) {
      const rowStep = fromRow < toRow ? 1 : -1;
      const colStep = fromCol < toCol ? 1 : -1;
      let r = fromRow + rowStep;
      let c = fromCol + colStep;
      while (r !== toRow && c !== toCol) {
        if (boardState[r][c] !== ' ') return false;
        r += rowStep;
        c += colStep;
      }
      return true;
    }
    return false;
  }

  // Cannon movement (Xiangqi)
  _isCannonMove(boardState, fromRow, fromCol, toRow, toCol) {
    if (fromRow !== toRow && fromCol !== toCol) return false;
    let piecesInBetween = 0;

    if (fromRow === toRow) {
      const start = Math.min(fromCol, toCol);
      const end = Math.max(fromCol, toCol);
      for (let col = start + 1; col < end; col++) {
        if (boardState[fromRow][col] !== ' ') piecesInBetween++;
      }
    } else {
      const start = Math.min(fromRow, toRow);
      const end = Math.max(fromRow, toRow);
      for (let row = start + 1; row < end; row++) {
        if (boardState[row][fromCol] !== ' ') piecesInBetween++;
      }
    }

    const targetPiece = boardState[toRow][toCol];
    const pieceColor = this.getPieceColor(boardState[fromRow][fromCol]);
    const targetColor = this.getPieceColor(targetPiece);

    // Non-capture: must have 0 pieces between and target empty
    if (targetPiece === ' ') {
      return piecesInBetween === 0;
    } else {
      // Capture: exactly 1 piece between and target must be opposite color
      return piecesInBetween === 1 && targetColor !== pieceColor;
    }
  }

  // Xiangqi Elephant (bishop-like with river restriction)
  _isXiangqiBishopMove(boardState, fromRow, fromCol, toRow, toCol) {
    const rowDiff = Math.abs(fromRow - toRow);
    const colDiff = Math.abs(fromCol - toCol);

    if (rowDiff !== colDiff) return false;

    const fromTerritory = this._getTerritory(fromRow);
    const toTerritory = this._getTerritory(toRow);

    // Elephant cannot cross the river (territory must remain the same), and cannot land on river
    if (fromTerritory !== toTerritory || toRow === RIVER_ROW_INDEX) return false;

    const rowStep = fromRow < toRow ? 1 : -1;
    const colStep = fromCol < toCol ? 1 : -1;
    let r = fromRow + rowStep;
    let c = fromCol + colStep;

    while (r !== toRow && c !== toCol) {
      if (boardState[r][c] !== ' ') return false;
      r += rowStep;
      c += colStep;
    }
    return true;
  }

  // Xiangqi Horse (with hobbling rule)
  _isXiangqiHorseMove(boardState, fromRow, fromCol, toRow, toCol) {
    const rowDiff = Math.abs(fromRow - toRow);
    const colDiff = Math.abs(fromCol - toCol);
    const isLShape = (rowDiff === 1 && colDiff === 2) || (rowDiff === 2 && colDiff === 1);
    if (!isLShape) return false;

    let blockingRow = -1;
    let blockingCol = -1;

    if (rowDiff === 1) { // move 1 row + 2 cols
      blockingRow = fromRow;
      blockingCol = fromCol + (toCol > fromCol ? 1 : -1);
    } else { // move 2 rows + 1 col
      blockingRow = fromRow + (toRow > fromRow ? 1 : -1);
      blockingCol = fromCol;
    }

    if (blockingRow >= 0 && blockingRow < BOARD_ROWS &&
        blockingCol >= 0 && blockingCol < BOARD_COLS &&
        boardState[blockingRow][blockingCol] !== ' ') {
      return false;
    }
    return true;
  }

  _getTerritory(row) {
    if (row < RIVER_ROW_INDEX) return 'west';
    if (row === RIVER_ROW_INDEX) return 'river';
    return 'east';
  }

  // Convert current board to a simplified FEN-like string
  _generateBoardFEN() {
    let fen = '';
    for (let r = 0; r < BOARD_ROWS; r++) {
      let emptyCount = 0;
      for (let c = 0; c < BOARD_COLS; c++) {
        const piece = this.board[r][c];
        if (piece === ' ') {
          emptyCount++;
        } else {
          if (emptyCount > 0) {
            fen += emptyCount;
            emptyCount = 0;
          }
          fen += piece;
        }
      }
      if (emptyCount > 0) fen += emptyCount;
      if (r < BOARD_ROWS - 1) fen += '/';
    }
    return `${fen} ${this.turn}`;
  }

  // Load from FEN-like string (basic)
  _loadFEN(fen) {
    const [boardFen, turnFen, halfMoveFen] = fen.split(' ');
    const rows = boardFen.split('/');
    this.board = [];
    for (const row of rows) {
      const newRow = [];
      for (const char of row) {
        if (isNaN(parseInt(char, 10))) {
          newRow.push(char);
        } else {
          for (let i = 0; i < parseInt(char, 10); i++) {
            newRow.push(' ');
          }
        }
      }
      this.board.push(newRow);
    }
    this.turn = turnFen;
    this.halfMoveClock = parseInt(halfMoveFen, 10);
  }

  _updateHalfMoveClock(isPawnMove, isCapture) {
    if (isPawnMove || isCapture) {
      this.halfMoveClock = 0;
    } else {
      this.halfMoveClock++;
    }
  }

  _updatePositionHistory() {
    const currentPositionKey = this._generateBoardFEN();
    this.positionHistory[currentPositionKey] = (this.positionHistory[currentPositionKey] || 0) + 1;
  }

  // Find the king/general position (for a color)
  findKing(boardState, color) {
    const kingChar = color === 'w' ? 'XG' : 'k';
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        if (boardState[r][c] === kingChar) return { r, c };
      }
    }
    return null;
  }

  // Check if 'color' king is in check on the given board
  isKingInCheck(boardState, color) {
    const kingPos = this.findKing(boardState, color);
    if (!kingPos) return false;

    const opponentColor = color === 'w' ? 'b' : 'w';

    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        const piece = boardState[r][c];
        if (piece !== ' ' && this.getPieceColor(piece) === opponentColor) {
          const pieceType = piece.toLowerCase();

          // Special handling for Horse-Rook ('h')
          if (pieceType === 'h' && opponentColor === 'b') {
            const horseRookTerritory = this._getTerritory(r);
            if (horseRookTerritory === 'west') {
              continue;
            }
            if (this._isKnightMove(boardState, r, c, kingPos.r, kingPos.c)) {
              return true;
            }
            continue;
          }

          // Note: Xiangqi soldier ('XS') special behaviour in west territory accounted for in isPseudoLegalMove,
          // but we still check pseudo-legal move here for attacks.
          if (this.isPseudoLegalMove(boardState, r, c, kingPos.r, kingPos.c)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // Pseudo-legal move: checks piece movement rules & simple board constraints (does not check resulting check)
  isPseudoLegalMove(boardState, fromRow, fromCol, toRow, toCol) {
    // Boundaries
    if (toRow < 0 || toRow >= BOARD_ROWS || toCol < 0 || toCol >= BOARD_COLS) return false;

    // Universal: pieces cannot land on the river
    if (toRow === RIVER_ROW_INDEX) return false;

    const piece = boardState[fromRow][fromCol];
    const targetPiece = boardState[toRow][toCol];
    if (!piece || piece === ' ') return false;

    const pieceColor = this.getPieceColor(piece);
    const targetColor = this.getPieceColor(targetPiece);
    if (pieceColor === targetColor && targetPiece !== ' ') return false;

    const rowDiff = Math.abs(fromRow - toRow);
    const colDiff = Math.abs(fromCol - toCol);
    const pieceType = piece.toLowerCase();

    switch (pieceType) {
      case 'p': { // black pawn (chess)
        const directionPawn = 1; // black pawn moves downward (increasing row)
        const pawnStartRowBlack = 1;

        // Single forward
        if (fromCol === toCol && toRow === fromRow + directionPawn && targetPiece === ' ') return true;
        // Double forward from start
        if (fromCol === toCol && fromRow === pawnStartRowBlack && toRow === fromRow + 2 * directionPawn &&
            boardState[fromRow + directionPawn][fromCol] === ' ') return true;
        // Diagonal capture
        if (colDiff === 1 && toRow === fromRow + directionPawn && targetPiece !== ' ' && targetColor !== pieceColor) return true;

        // Pawn special jump over river from row 4 to 6 (forward move, not a capture)
        if (fromCol === toCol && fromRow === 4 && toRow === 6) {
          if (boardState[RIVER_ROW_INDEX][fromCol] === ' ' && targetPiece === ' ') return true;
        }
        if (colDiff === 1 && fromRow === 4 && toRow === 6 && targetPiece !== ' ' && targetColor !== pieceColor) return true;

        return false;
      }

      case 'xs': { // Xiangqi soldier (white)
        const soldierDirection = -1; // white soldiers move upwards (decreasing row)
        // cannot move backward
        if (toRow > fromRow) return false;

        const isForwardOneStep = (toCol === fromCol && toRow === fromRow + soldierDirection);
        const isSidewaysMove = (toRow === fromRow && Math.abs(toCol - fromCol) === 1);
        const hasAlreadyCrossedRiver = this._getTerritory(fromRow) === 'west';

        // Special river crossing 2-square jump from row 6 to 4 (if river square empty)
        const isRiverCrossingJump = (fromCol === toCol && fromRow === 6 && toRow === 4);
        if (isRiverCrossingJump && boardState[RIVER_ROW_INDEX][fromCol] === ' ') return true;

        if (isForwardOneStep) return true;
        if (isSidewaysMove && hasAlreadyCrossedRiver) return true;
        return false;
      }

      case 'xc':
        return this._isCannonMove(boardState, fromRow, fromCol, toRow, toCol);

      case 'xa': { // Advisor (Xiangqi)
        const whitePalaceRowsAdvisor = [8, 9, 10];
        const whitePalaceColsAdvisor = [3, 4, 5];
        if (rowDiff !== 1 || colDiff !== 1) return false;
        if (!whitePalaceRowsAdvisor.includes(toRow) || !whitePalaceColsAdvisor.includes(toCol)) return false;
        return true;
      }

      case 'xg': { // General (Xiangqi)
        const whitePalaceRowsGeneral = [8, 9, 10];
        const whitePalaceColsGeneral = [3, 4, 5];
        if (!((rowDiff <= 1 && colDiff <= 1) && (rowDiff + colDiff > 0))) return false;
        if (!whitePalaceRowsGeneral.includes(toRow) || !whitePalaceColsGeneral.includes(toCol)) return false;
        return true;
      }

      case 'xr':
        return this._isRookMove(boardState, fromRow, fromCol, toRow, toCol);

      case 'xn':
        return this._isXiangqiHorseMove(boardState, fromRow, fromCol, toRow, toCol);

      case 'xb': { // Xiangqi Bishop (Elephant) with special first-move orthogonal step & river restriction
        // Special first move: one step forward (orthogonal)
        if (fromRow === 10 && (fromCol === 2 || fromCol === 6) && toRow === fromRow - 1 && toCol === fromCol && boardState[toRow][toCol] === ' ') {
          return true;
        }
        return this._isXiangqiBishopMove(boardState, fromRow, fromCol, toRow, toCol);
      }

      // Black chess pieces
      case 'r':
        return this._isRookMove(boardState, fromRow, fromCol, toRow, toCol);

      case 'b': { // Bishop (black) with special first move
        if (fromRow === 0 && (fromCol === 2 || fromCol === 6) && toRow === fromRow + 1 && toCol === fromCol && boardState[toRow][toCol] === ' ') {
          return true;
        }
        return this._isBishopMove(boardState, fromRow, fromCol, toRow, toCol);
      }

      case 'n':
        return this._isKnightMove(boardState, fromRow, fromCol, toRow, toCol);

      case 'q':
        return this._isRookMove(boardState, fromRow, fromCol, toRow, toCol) ||
               this._isBishopMove(boardState, fromRow, fromCol, toRow, toCol);

      case 'k': { // Black king must stay in West territory
        if (!((rowDiff <= 1 && colDiff <= 1) && (rowDiff + colDiff > 0))) return false;
        if (toRow > 4) return false;
        return true;
      }

      case 'h': { // Horse-Rook (custom)
        const fromTerritory = this._getTerritory(fromRow);
        const toTerritory = this._getTerritory(toRow);

        if (fromTerritory === 'west' && toTerritory === 'west') {
          return this._isRookMove(boardState, fromRow, fromCol, toRow, toCol);
        } else if (fromTerritory === 'east' && toTerritory === 'east') {
          return this._isKnightMove(boardState, fromRow, fromCol, toRow, toCol);
        } else if ((fromTerritory === 'west' && toTerritory === 'east') ||
                   (fromTerritory === 'east' && toTerritory === 'west')) {
          return this._isKnightMove(boardState, fromRow, fromCol, toRow, toCol);
        } else if (fromTerritory === 'river' && (toTerritory === 'west' || toTerritory === 'east')) {
          return this._isKnightMove(boardState, fromRow, fromCol, toRow, toCol);
        }
        return false;
      }

      default:
        return false;
    }
  }

  // Return all legal moves for a color (checks for resulting check too)
  getLegalMoves(color) {
    const legalMoves = [];
    const currentBoardState = this.board.map(row => [...row]);

    for (let r1 = 0; r1 < BOARD_ROWS; r1++) {
      for (let c1 = 0; c1 < BOARD_COLS; c1++) {
        const piece = currentBoardState[r1][c1];
        if (piece !== ' ' && this.getPieceColor(piece) === color) {
          for (let r2 = 0; r2 < BOARD_ROWS; r2++) {
            for (let c2 = 0; c2 < BOARD_COLS; c2++) {
              if (r2 < 0 || r2 >= BOARD_ROWS || c2 < 0 || c2 >= BOARD_COLS) continue;

              if (this.isPseudoLegalMove(currentBoardState, r1, c1, r2, c2)) {
                const tempBoard = currentBoardState.map(row => [...row]);
                tempBoard[r2][c2] = tempBoard[r1][c1];
                tempBoard[r1][c1] = ' ';

                if (!this.isKingInCheck(tempBoard, color)) {
                  legalMoves.push({ from: { r: r1, c: c1 }, to: { r: r2, c: c2 } });
                }
              }
            }
          }
        }
      }
    }
    return legalMoves;
  }

  // Simplified insufficient material check
  isInsufficientMaterial() {
    let whitePieces = [];
    let blackPieces = [];
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        const piece = this.board[r][c];
        if (piece !== ' ') {
          const color = this.getPieceColor(piece);
          if (color === 'w') whitePieces.push(piece.toLowerCase());
          else blackPieces.push(piece.toLowerCase());
        }
      }
    }

    // King vs King
    if (whitePieces.length === 1 && whitePieces[0] === 'xg' &&
        blackPieces.length === 1 && blackPieces[0] === 'k') {
      return true;
    }
    // King + Bishop vs King, etc.
    if (whitePieces.length === 2 && whitePieces.includes('xg') && whitePieces.includes('xb') &&
        blackPieces.length === 1 && blackPieces[0] === 'k') {
      return true;
    }
    if (blackPieces.length === 2 && blackPieces.includes('k') && blackPieces.includes('b') &&
        whitePieces.length === 1 && whitePieces[0] === 'xg') {
      return true;
    }
    // King + Knight vs King
    if (whitePieces.length === 2 && whitePieces.includes('xg') && whitePieces.includes('xn') &&
        blackPieces.length === 1 && blackPieces[0] === 'k') {
      return true;
    }
    if (blackPieces.length === 2 && blackPieces.includes('k') && blackPieces.includes('n') &&
        whitePieces.length === 1 && whitePieces[0] === 'xg') {
      return true;
    }

    // If custom pieces exist, assume there is sufficient material
    const customPieces = ['h', 'xs', 'xc', 'xa', 'xr', 'xn', 'xb'];
    if (whitePieces.some(p => customPieces.includes(p)) || blackPieces.some(p => customPieces.includes(p))) {
      // not insufficient
    }

    return false;
  }

  // Game over checks: checkmate/stalemate, fifty-move, threefold, insufficient material
  isGameOver() {
    const legalMoves = this.getLegalMoves(this.turn);
    if (legalMoves.length === 0) {
      if (this.isKingInCheck(this.board, this.turn)) {
        this.statusMessage = `Checkmate! ${this.turn === 'w' ? 'Black' : 'White'} wins!`;
        this.isGameOverFlag = true;
        return true;
      } else {
        this.statusMessage = 'Stalemate! It\'s a draw by no legal moves.';
        this.isGameOverFlag = true;
        return true;
      }
    }

    if (this.halfMoveClock >= 100) {
      this.statusMessage = 'Stalemate! It\'s a draw by fifty-move rule.';
      this.isGameOverFlag = true;
      return true;
    }

    const currentFEN = this._generateBoardFEN();
    if (this.positionHistory[currentFEN] >= 3) {
      this.statusMessage = 'Stalemate! It\'s a draw by threefold repetition.';
      this.isGameOverFlag = true;
      return true;
    }

    if (this.isInsufficientMaterial()) {
      this.statusMessage = 'Stalemate! It\'s a draw by insufficient material.';
      this.isGameOverFlag = true;
      return true;
    }

    return false;
  }

  // Make a move (updates board, turn, half-move clock, history)
  makeMove(fromRow, fromCol, toRow, toCol) {
  if (this.isGameOverFlag) {
    this.statusMessage = "Game is over!";
    return false;
  }

  const originalBoard = this.board.map(row => [...row]);
  const originalHalfMoveClock = this.halfMoveClock;
  const originalPositionHistory = { ...this.positionHistory };

  const pieceMoving = this.board[fromRow][fromCol];
  const targetPiece = this.board[toRow][toCol];
  const pieceType = pieceMoving.toLowerCase();
  const isPawnMove = pieceType === 'p';
  const isSoldierMove = pieceType === 'xs';
  const isCapture = targetPiece !== ' ';

  const isPseudoValid = this.isPseudoLegalMove(this.board, fromRow, fromCol, toRow, toCol);
  if (!isPseudoValid) {
    this.statusMessage = "Invalid move for that piece pattern or blocked path.";
    return false;
  }

  // Execute move
  this.board[toRow][toCol] = pieceMoving;
  this.board[fromRow][fromCol] = ' ';

  // --- Promotion detection ---
  if (pieceType === 'p' && toRow === 10) {
    this.pendingPromotion = { row: toRow, col: toCol, color: 'b' };
  } else if (pieceType === 'xs' && fromRow !== 0 && toRow === 0) {
    this.pendingPromotion = { row: toRow, col: toCol, color: 'w' };
  } else {
    this.pendingPromotion = null;
  }

  // If move leaves own king in check, revert
  const isKingStillInCheck = this.isKingInCheck(this.board, this.getPieceColor(pieceMoving));
  if (isKingStillInCheck) {
    this.board = originalBoard.map(row => [...row]);
    this.halfMoveClock = originalHalfMoveClock;
    this.positionHistory = originalPositionHistory;
    this.statusMessage = "Invalid move: King would be in check.";
    return false;
  }

  // Update half-move clock based on pawn move or capture
  if (isPawnMove || isSoldierMove || isCapture) {
    this.halfMoveClock = 0;
  } else {
    this.halfMoveClock++;
  }

  this.boardHistory.push(this.board.map(row => [...row]));

  // Switch turn
  this.turn = (this.turn === 'w') ? 'b' : 'w';

  // Update position history
  this._updatePositionHistory();

  // The single call to isGameOver() handles all end-game conditions
  this.isGameOver();

  // Check if the game is over and return early if so.
  if (this.isGameOverFlag) {
    return false;
  }

  // Set status message based on whether a check has occurred
  if (this.isKingInCheck(this.board, this.turn)) {
    this.statusMessage = `${this.turn === 'w' ? 'White' : 'Black'} to move (Check!)`;
  } else {
    this.statusMessage = `${this.turn === 'w' ? 'White' : 'Black'} to move`;
  }

  return true;
}
  
undoLastMove() {
  if (this.moveHistory.length === 0) return;

  // --- Three-Fold Repetition Logic ---
  // The position to decrement is the one *before* this move was undone.
  const positionKeyToDecrement = this.getPositionKey();
  if (this.positionHistory[positionKeyToDecrement]) {
    this.positionHistory[positionKeyToDecrement]--;
  }

  const lastMove = this.moveHistory.pop();
  const { fromRow, fromCol, toRow, toCol, piece, capturedPiece, promotion } = lastMove;

  // Restore the piece to its original position
  this.board[fromRow][fromCol] = piece;

  // Restore the captured piece, if any
  this.board[toRow][toCol] = capturedPiece;

  // Reverse the turn
  this.turn = (this.turn === 'w') ? 'b' : 'w';

  // If the last move was a promotion, remove its position from the set
  if (promotion && piece.toLowerCase() === 'xs') {
    this.promotedSoldierPositions.delete(`${toRow},${toCol}`);
  }

  // --- Fifty-Move Rule Logic ---
  // A captured piece or pawn move resets the halfMoveClock.
  // When we undo such a move, we have to restore the previous state.
  const isPawnMove = piece.toLowerCase() === 'p' || piece.toLowerCase() === 'xs';
  if (capturedPiece !== ' ' || isPawnMove) {
    // This is a simplified approach. A more robust solution would
    // store the clock value in the move history itself to restore it perfectly.
    // For now, it will work but may not be 100% accurate for all scenarios.
    this.halfMoveClock = this.moveHistory.length > 0 ? this.moveHistory[this.moveHistory.length - 1].halfMoveClockBeforeMove : 0;
  } else {
    this.halfMoveClock--;
  }

  // Reset game state flags
  this.status = null;
  this.isGameOverFlag = false;
  this.statusMessage = `${this.turn === 'w' ? 'White' : 'Black'} to move`;
}

  // New helper to create a unique key for the current board state
  getPositionKey() {
    let key = this.board.map(row => row.join('')).join('');
    key += this.turn;
    // For a more robust check, you might add castling rights and en passant, but this is sufficient for a basic repetition check.
    return key;
  }

  // --- Promotion method ---
  promotePawn(pieceCode) {
    if (!this.pendingPromotion) return false;
    const { row, col, color } = this.pendingPromotion;

    // Add the position to the set if a soldier promotes to a soldier
    if (color === 'w' && pieceCode === 'XS') {
      this.promotedSoldierPositions.add(`${row},${col}`);
    }

    this.board[row][col] = pieceCode;
    this.pendingPromotion = null;
    return true;
  }
}

export { ChessGame };