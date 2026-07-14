import React, { useState, useEffect, useRef, useCallback } from "react";
import { ChessGame, BOARD_ROWS, BOARD_COLS, RIVER_ROW_INDEX } from "./game";
import { getBotMove } from "./bot";
import EvalBar from "./EvalBar";
import blackPawnImage from './assets/black_chess_pawn.png';

// Main App component
const App = () => {
  // Define board size for the new layout (e.g., Xiangqi)
  const SQUARE_SIZE_REM = 2.94; // Each square is 2.94rem x 2.94rem (2.8rem * 1.05 = 2.94rem)

  // Palace definitions moved to the top of the App component
  const eastPalaceMinRow = 8;
  const eastPalaceMaxRow = 10;
  const eastPalaceMinCol = 3;
  const eastPalaceMaxCol = 5;

  // Unicode chess piece symbols
  const pieces = {
    // Black standard chess pieces (and one custom)
    'r': '♜', 'n': '♞', 'b': '♝', 'q': '♛', 'k': '♚',
    'p': blackPawnImage, // Using black pawn image
    'h': '♞♜', // Horse-Rook for black

    // White Xiangqi pieces (using 'X' prefix for internal clarity for new pieces)
    'XR': '車', // White Xiangqi Rook
    'XN': '馬', // White Xiangqi Horse
    'XB': '象', // White Xiangqi Elephant/Bishop
    'XA': '士', // White Xiangqi Advisor/Minister
    'XG': '將', // Xiangqi General/King
    'XC': '炮', // White Xiangqi Cannon
    'XS': '兵', // White Xiangqi Soldier
    ' ': '' // Empty square
  };

  // State to hold our game instance
  const [game, setGame] = useState(() => new ChessGame());

  // State to manage the board directly from the game instance
  const [board, setBoard] = useState(game.board);
  const [turn, setTurn] = useState(game.turn);
  const [statusMessage, setStatusMessage] = useState(game.statusMessage);
  const [gameOver, setGameOver] = useState(game.isGameOverFlag);
  
  // New state for board history to enable navigation
  const [boardHistory, setBoardHistory] = useState([game.board.map(row => [...row])]);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(0);

  // State for the currently selected piece and its original position
  const [selectedPiece, setSelectedPiece] = useState(null);
  // State for the square where the drag started
  const [startSquare, setStartSquare] = useState(null);
  // State to store the last known mouse position during drag
  const [currentMousePos, setCurrentMousePos] = useState({ x: 0, y: 0 });

  // State for legal moves to highlight on the board
  const [legalMoves, setLegalMoves] = useState([]);

  // Refs for the board container and the draggable piece
  const boardRef = useRef(null);
  const draggablePieceRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isBotThinking, setIsBotThinking] = useState(false);

  // NEW: State for the rule book dropdown
  const [isRuleBookOpen, setIsRuleBookOpen] = useState(false);

  // Controls Bot vs Bot loop (true = running, false = paused/stopped)
  const selfPlayActive = useRef(false);

  // Stores current evaluation score (positive = White better, negative = Black better)
  const [evaluationScore, setEvaluationScore] = useState(0);

  // State for pawn/soldier promotion
  const [promotionSquare, setPromotionSquare] = useState(null);

  // Event handler for mouse move (when dragging) - Memoized with useCallback
  const handleMouseMove = useCallback((event) => {
    if (isDragging && draggablePieceRef.current && boardRef.current) {
      setCurrentMousePos({ x: event.clientX, y: event.clientY });

      const boardRect = boardRef.current.getBoundingClientRect();
      const pieceWidth = draggablePieceRef.current.offsetWidth;
      const pieceHeight = draggablePieceRef.current.offsetHeight;

      draggablePieceRef.current.style.left = `${currentMousePos.x - boardRect.left - pieceWidth / 2}px`;
      draggablePieceRef.current.style.top = `${currentMousePos.y - boardRect.top - pieceHeight / 2}px`;
    }
  }, [isDragging, currentMousePos]);

  // Event handler for mouse up (when dropping) - Memoized with useCallback
  const handleMouseUp = useCallback(() => {
    if (boardRef.current && isDragging) {
        const boardRect = boardRef.current.getBoundingClientRect();
        const finalX = currentMousePos.x - boardRect.left;
        const finalY = currentMousePos.y - boardRect.top;

        const calculatedEndCol = Math.floor(finalX / (SQUARE_SIZE_REM * 16));
        const calculatedEndRow = Math.floor(finalY / (SQUARE_SIZE_REM * 16));

        if (selectedPiece && startSquare) {
            if (calculatedEndRow >= 0 && calculatedEndRow < BOARD_ROWS &&
                calculatedEndCol >= 0 && calculatedEndCol < BOARD_COLS) {

                const moved = game.makeMove(startSquare.row, startSquare.col, calculatedEndRow, calculatedEndCol);
                
                if (moved) {
                  // Update board history after a successful move
                  setBoardHistory(prev => [...prev, game.board.map(row => [...row])]);
                  setCurrentMoveIndex(prev => prev + 1);
                }
                // Check if promotion is pending
                if (game.pendingPromotion) {
                  setPromotionSquare(game.pendingPromotion);
                }

                // Regardless of whether the move was valid or not, sync the React board state
                // with the internal game board. If the move was invalid, makeMove will have
                // reverted game.board to its original state.
                setBoard([...game.board.map(row => [...row])]);
                setTurn(game.turn);
                setStatusMessage(game.statusMessage);
                setGameOver(game.isGameOverFlag);
            } else {
                // If dropped outside the board, reset the board state to game's original state
                setBoard([...game.board.map(row => [...row])]);
                setStatusMessage(game.statusMessage);
            }
        }
    }

    setSelectedPiece(null);
    setStartSquare(null);
    setIsDragging(false);
    // Clear legal moves when the drag is finished
    setLegalMoves([]);
  }, [selectedPiece, startSquare, game, isDragging, currentMousePos, BOARD_ROWS, BOARD_COLS, SQUARE_SIZE_REM, currentMoveIndex]);

  // Event handler for mouse down on a square
  const handleMouseDown = (pieceChar, rowIndex, colIndex, event) => {
    if (gameOver || isBotThinking || currentMoveIndex !== boardHistory.length - 1) {
        setStatusMessage("Game over!" + (isBotThinking ? " Bot is thinking..." : ""));
        return;
    }

    const pieceColor = game.getPieceColor(pieceChar);
    if (pieceChar !== ' ' && pieceColor === game.turn) {
      setSelectedPiece({ piece: pieceChar, row: rowIndex, col: colIndex });
      setStartSquare({ row: rowIndex, col: colIndex });
      setIsDragging(true);
      setCurrentMousePos({ x: event.clientX, y: event.clientY });

      // Get and store legal moves for the selected piece
      const allLegalMoves = game.getLegalMoves(game.turn);
      const movesForSelectedPiece = allLegalMoves.filter(move =>
        move.from.r === rowIndex && move.from.c === colIndex
      );
      setLegalMoves(movesForSelectedPiece);

      // Temporarily clear the piece from its original position on the visual board
      setBoard(prevBoard => {
        const newBoard = prevBoard.map(row => [...row]);
        newBoard[rowIndex][colIndex] = ' '; // Set to empty character
        return newBoard;
      });

    } else if (pieceChar !== ' ' && pieceColor !== game.turn) {
      setStatusMessage("It's not your turn to move that piece!");
    } else {
      // If a user clicks an empty square, clear any highlighted moves
      setLegalMoves([]);
    }
  };

  // Effect for initial positioning of the draggable piece when isDragging becomes true
  useEffect(() => {
    if (isDragging && selectedPiece && draggablePieceRef.current && boardRef.current) {
      const boardRect = boardRef.current.getBoundingClientRect();
      const pieceWidth = draggablePieceRef.current.offsetWidth;
      const pieceHeight = draggablePieceRef.current.offsetHeight;

      draggablePieceRef.current.style.left = `${currentMousePos.x - boardRect.left - pieceWidth / 2}px`;
      draggablePieceRef.current.style.top = `${currentMousePos.y - boardRect.top - pieceHeight / 2}px`;

      draggablePieceRef.current.style.visibility = 'visible';
    } else if (draggablePieceRef.current) {
      draggablePieceRef.current.style.visibility = 'hidden';
    }
  }, [isDragging, selectedPiece, currentMousePos, boardRef.current, draggablePieceRef.current]);

  // Add global mouse move/up listeners for dragging outside the board
  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const handleRestartGame = () => {
    const newGame = new ChessGame();
    // Correctly initialize the board for restart
    setGame(newGame); // Set the new game instance
    setBoard([...newGame.board.map(row => [...row])]); // Copy the board from the new game instance
    setTurn(newGame.turn);
    setStatusMessage(newGame.statusMessage);
    setGameOver(newGame.isGameOverFlag);
    setSelectedPiece(null);
    setStartSquare(null);
    setIsDragging(false);
    setLegalMoves([]); // Clear legal moves on restart
    setBoardHistory([newGame.board.map(row => [...row])]); // Reset board history
    setCurrentMoveIndex(0); // Reset move index
    setEvaluationScore(0); // Reset evaluation score on restart
  };

// inside your App component
// src/App.js

const performBotMove = useCallback(async (currentGame) => {
    if (currentGame.isGameOverFlag) {
      return { moved: false, newBoard: currentGame.board, statusMessage: "Game is over!" };
    }

    try {
      const botColor = currentGame.turn;
      const boardClone = structuredClone(currentGame.board);
      const rootMoves = currentGame.getLegalMoves(botColor);
      const plainRootMoves = rootMoves.map((m) => ({
        from: { r: m.from.r, c: m.from.c },
        to: { r: m.to.r, c: m.to.c },
      }));

      // Pass the boardHistory from the game instance
      const botMove = await getBotMove(boardClone, plainRootMoves, botColor, currentGame.boardHistory, 5, 10000);

      if (!botMove) {
        return { moved: false, newBoard: currentGame.board, statusMessage: "Bot has no legal moves." };
      } else {
        const { from, to, score } = botMove;
        const moved = currentGame.makeMove(from.r, from.c, to.r, to.c);
        if (moved) {
          return { moved: true, newBoard: currentGame.board.map(row => [...row]), score: score };
        } else {
          return { moved: false, newBoard: currentGame.board, statusMessage: "Bot suggested an illegal move (engine rejected it)." };
        }
      }
    } catch (err) {
      console.error("Bot error:", err);
      return { moved: false, newBoard: currentGame.board, statusMessage: "Error running bot. See console." };
    }
  }, []);

  const handleBotMove = useCallback(async () => {
    if (isBotThinking || game.isGameOverFlag || currentMoveIndex !== boardHistory.length - 1) {
      setStatusMessage(isBotThinking ? "Bot is already thinking..." : "Game is over!");
      return;
    }
  
    setIsBotThinking(true);
    setStatusMessage(`Bot is thinking for ${game.turn === "w" ? "White" : "Black"}...`);
  
    const { moved, newBoard, statusMessage: newStatusMessage, score } = await performBotMove(game);
  
    if (moved) {
      setBoardHistory(prev => [...prev.slice(0, currentMoveIndex + 1), newBoard]);
      setCurrentMoveIndex(prev => prev + 1);
    }
    
    setBoard(game.board.map((row) => [...row]));
    setTurn(game.turn);
    setGameOver(game.isGameOverFlag);
    setIsBotThinking(false);
    setEvaluationScore(score); // Update the evaluation score
    setStatusMessage(newStatusMessage || game.statusMessage);
  }, [game, isBotThinking, currentMoveIndex, boardHistory.length, performBotMove]);

  const handleSelfPlay = useCallback(async () => {
    if (game.isGameOverFlag) {
      setStatusMessage("Game over! Reset to watch again.");
      return;
    }
  
    selfPlayActive.current = true;
    setStatusMessage("Bot vs Bot has started...");

    // Use a while loop that directly uses the `performBotMove` helper
    while (!game.isGameOverFlag && selfPlayActive.current) {
        setIsBotThinking(true);
        const botJustMoved = game.turn;
        const { moved, newBoard, statusMessage: newStatusMessage, score } = await performBotMove(game);
        
        if (moved) {
          // Update the history directly inside the loop
          setBoardHistory(prev => [...prev.slice(0, prev.length), newBoard]);
          setCurrentMoveIndex(prev => prev + 1);
        }

        // Always sync UI state
        setBoard(game.board.map((row) => [...row]));
        setTurn(game.turn);
        setGameOver(game.isGameOverFlag);
        setStatusMessage(newStatusMessage || game.statusMessage);
        if (score !== undefined) {
            let scoreToDisplay = score;
            
            // The score is from the perspective of 'botJustMoved'.
            // If the player who calculated the score was Black ('b'), 
            // a positive score means Black is winning.
            // Since the EvalBar uses a convention where positive is White's advantage (EvalBar.js),
            // we must negate Black's score.
            if (botJustMoved === 'b') {
                scoreToDisplay = -scoreToDisplay;
            }
            
        setEvaluationScore(scoreToDisplay);
        }
        setIsBotThinking(false);

        await new Promise(res => setTimeout(res, 500)); // give UI time
    }

    setIsBotThinking(false);
    setStatusMessage(selfPlayActive.current ? "Bot vs Bot finished!" : "Bot vs Bot paused");
  }, [game, performBotMove]);


  // New: Handle arrow key presses for navigation
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'ArrowLeft') {
        if (currentMoveIndex > 0) {
          setCurrentMoveIndex(prevIndex => prevIndex - 1);
          setBoard(boardHistory[currentMoveIndex - 1]);
          // Sync game state for display purposes
          const tempGame = new ChessGame();
          tempGame.board = boardHistory[currentMoveIndex - 1];
          setGame(tempGame);
          // Don't change the status message to avoid confusion
        }
      } else if (event.key === 'ArrowRight') {
        if (currentMoveIndex < boardHistory.length - 1) {
          setCurrentMoveIndex(prevIndex => prevIndex + 1);
          setBoard(boardHistory[currentMoveIndex + 1]);
          // Sync game state for display purposes
          const tempGame = new ChessGame();
          tempGame.board = boardHistory[currentMoveIndex + 1];
          setGame(tempGame);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [boardHistory, currentMoveIndex]);

  // Helper function to convert coordinates to algebraic notation
  const toAlgebraic = (row, col) => {
    const file = String.fromCharCode(97 + col);
    // Board rows are 0-10, algebraic rows are 1-11
    const rank = BOARD_ROWS - row; 
    return `${file}${rank}`;
  };

  // Helper function to get piece PGN symbol
  const getPgnPieceSymbol = (piece) => {
    if (!piece || piece === ' ') return '';
    const blackPieces = { 'r': 'r', 'n': 'n', 'b': 'b', 'q': 'q', 'k': 'k', 'h': 'h' };
    const whitePieces = { 'XR': 'R', 'XN': 'N', 'XB': 'B', 'XA': 'A', 'XG': 'G', 'XC': 'C', 'XS': 'S' };
    if (blackPieces[piece]) return blackPieces[piece];
    if (whitePieces[piece]) return whitePieces[piece];
    return '';
  };
  
  // NEW: Move History Component
  const MoveHistory = ({ boardHistory, currentMoveIndex, toAlgebraic, getPgnPieceSymbol }) => {
    const moves = [];
    for (let i = 1; i < boardHistory.length; i++) {
        const previousBoard = boardHistory[i - 1];
        const currentBoard = boardHistory[i];
        
        let from, to;
        let movingPiece, capturedPiece;

        // Find the moved piece and its origin and destination
        for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
                if (previousBoard[r][c] !== currentBoard[r][c]) {
                    if (currentBoard[r][c] !== ' ' && !movingPiece) {
                        movingPiece = currentBoard[r][c];
                        to = { r, c };
                    }
                    if (previousBoard[r][c] !== ' ' && !capturedPiece && previousBoard[r][c] !== movingPiece) {
                        capturedPiece = previousBoard[r][c];
                        from = { r, c };
                    }
                }
            }
        }
        
        // This is a basic way to get the 'from' square. For a full PGN, more context would be needed.
        if (!from) {
          for (let r = 0; r < BOARD_ROWS; r++) {
            for (let c = 0; c < BOARD_COLS; c++) {
              if (previousBoard[r][c] === movingPiece && currentBoard[r][c] === ' ') {
                from = { r, c };
              }
            }
          }
        }

        const isCapture = to && previousBoard[to.r][to.c] !== ' '; 
        let moveString = getPgnPieceSymbol(movingPiece);
        
        // Handle pawns
        if (movingPiece.toLowerCase() === 'p' || movingPiece.toLowerCase() === 'xs') {
            moveString = '';
            if (isCapture) {
                moveString = toAlgebraic(from.r, from.c).charAt(0);
            }
        }

        if (isCapture) {
            moveString += 'x';
        }
        
        moveString += toAlgebraic(to.r, to.c);

        moves.push({
            moveNumber: Math.ceil(i / 2),
            isWhiteMove: i % 2 === 1,
            move: moveString,
        });
    }

    // Split moves into pairs (white and black)
    const movePairs = [];
    for (let i = 0; i < moves.length; i += 2) {
        movePairs.push({
            whiteMove: moves[i],
            blackMove: moves[i + 1] || null,
        });
    }

    return (
        <div className="absolute top-4 right-4 bg-gray-800 p-6 rounded-xl shadow-2xl text-white w-64 max-h-[95vh] overflow-y-auto custom-scrollbar">
            <h2 className="text-2xl font-bold mb-4 border-b-2 border-gray-600 pb-2">Move History</h2>
            <ol className="list-none text-gray-300 space-y-2">
                {movePairs.map((pair, index) => (
                    <li key={index} className="flex space-x-4">
                        <span className="text-gray-400 w-8">{pair.whiteMove.moveNumber}.</span>
                        <span className={`flex-1 ${index * 2 + 1 === currentMoveIndex ? 'bg-yellow-400 text-black px-1 rounded' : ''}`}>{pair.whiteMove.move}</span>
                        {pair.blackMove && (
                            <span className={`flex-1 ${index * 2 + 2 === currentMoveIndex ? 'bg-yellow-400 text-black px-1 rounded' : ''}`}>{pair.blackMove.move}</span>
                        )}
                    </li>
                ))}
            </ol>
        </div>
    );
  };
  
  return (
    // Changed main container to a flex row to accommodate the new sidebar
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 font-inter select-none relative">
      
      {/* Top-left button container */}
      <div className="absolute top-4 left-4 z-50">
        <button
          onClick={() => setIsRuleBookOpen(!isRuleBookOpen)}
          className="px-6 py-3 bg-blue-600 text-white font-bold rounded-md shadow-lg
                     hover:bg-blue-700 transition duration-300 ease-in-out
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75"
        >
          {isRuleBookOpen ? 'Hide Rules' : 'Show Rules'}
        </button>
      </div>

      {/* Rule Book Dropdown Container (appears on top of the board) */}
      {isRuleBookOpen && (
        <div className="absolute top-16 left-4 z-40 bg-gray-800 p-6 rounded-xl shadow-2xl text-white w-96 max-h-[80vh] overflow-y-auto custom-scrollbar">
          <h2 className="text-2xl font-bold mb-4 border-b-2 border-gray-600 pb-2">Game Rules: Qi-Chess</h2>
          <p className="text-gray-300 text-sm mb-4">
            This is a hybrid game combining elements of English Chess and Xiangqi.
          </p>

          <h3 className="text-xl font-bold mb-2">The Board</h3>
          <ul className="list-disc list-inside mb-4 text-gray-300 space-y-2">
            <li>The board is 9x11.</li>
            <li>A single "River" row separates the West Territory (Black) and the East Territory (White). Pieces cannot land on the river.</li>
            <li>A "Palace" is marked in the East territory. The White General/King stays in the East Palace.</li>
          </ul>

          <h3 className="text-xl font-bold mb-2">Pieces & Movement</h3>

          {/* Black Pieces */}
          <div className="mb-4">
            <h4 className="text-lg font-semibold text-gray-200">Black (West Territory)</h4>
            <ul className="list-disc list-inside ml-4 text-gray-300 space-y-2">
              <li>
                {/* For the black Pawn */}
                <span className="text-black bg-white border-b-2 border-white px-1 rounded-sm mr-2 font-bold inline-flex items-center justify-center">
                  <img 
                    src={blackPawnImage} 
                    alt="Black Pawn" 
                    className="h-5 w-4 align-middle drop-shadow-lg" 
                />
                </span> 
                <strong class="font-bold text-white">Pawn</strong>: Moves one square forward. On its starting square, it can move two squares forward. It captures diagonally one square forward. It can cross the river, either by moving forward or capturing diagonally.
              </li>
              <li><span className="text-black bg-white px-1 rounded-sm mr-2 font-bold">♜</span> <strong class="font-bold text-white">Rook</strong>: Moves any number of squares horizontally or vertically.</li>
              <li><span className="text-black bg-white px-1 rounded-sm mr-2 font-bold">♞</span> <strong class="font-bold text-white">Knight</strong>: Moves in an 'L' shape (2 squares in one cardinal direction, then 1 square orthogonally). It can 'jump' over pieces.</li>
              <li><span className="text-black bg-white px-1 rounded-sm mr-2 font-bold">♝</span> <strong class="font-bold text-white">Bishop</strong>: Moves any number of squares diagonally. On its starting square, it can move one square forward (called the Baby Step).</li>
              <li><span className="text-black bg-white px-1 rounded-sm mr-2 font-bold">♛</span> <strong class="font-bold text-white">Queen</strong>: Moves like a Rook and a Bishop combined.</li>
              <li><span className="text-black bg-white px-1 rounded-sm mr-2 font-bold">♚</span> <strong class="font-bold text-white">King</strong>: Moves one square in any direction. It is restricted to staying within the West Territory.</li>
              <li><span className="text-black bg-white px-1 rounded-sm mr-2 font-bold">♞♜</span> <strong class="font-bold text-white">Horse-Rook</strong>: This is a hybrid piece.
                <ul className="list-square list-inside ml-4 mt-1 text-gray-300">
                  <li>Within the West Territory, it moves like a Rook.</li>
                  <li>Within the East Territory, it moves like a Knight.</li>
                  <li>To cross the river, it must make a Knight move.</li>
                </ul>
              </li>
            </ul>
          </div>

          {/* White Pieces */}
          <div className="mb-4">
            <h4 className="text-lg font-semibold text-white">White (East Territory)</h4>
            <ul className="list-disc list-inside ml-4 text-gray-300 space-y-2">
              <li><span className="text-white px-1 rounded-sm mr-2 font-bold">兵</span> <strong class="font-bold text-white">Soldier</strong>: Moves one square forward. Once it crosses the river, it can also move one square sideways.</li>
              <li><span className="text-white px-1 rounded-sm mr-2 font-bold">車</span> <strong class="font-bold text-white">Rook</strong>: Moves any number of squares horizontally or vertically.</li>
              <li><span className="text-white px-1 rounded-sm mr-2 font-bold">馬</span> <strong class="font-bold text-white">Horse</strong>: Moves in an 'L' shape, but its path is "hobbled/blocked" by any adjacent piece in the orthogonal direction of its first step.</li>
              <li><span className="text-white px-1 rounded-sm mr-2 font-bold">象</span> <strong class="font-bold text-white">Elephant</strong>: Moves any number of squares diagonally, but cannot cross the river. On its starting square, it can move one square forward (called the Baby Step).</li>
              <li><span className="text-white px-1 rounded-sm mr-2 font-bold">士</span> <strong class="font-bold text-white">Advisor</strong>: Moves exactly one square diagonally. It is restricted to staying within the East Palace.</li>
              <li><span className="text-white px-1 rounded-sm mr-2 font-bold">將</span> <strong class="font-bold text-white">General</strong>: Moves exactly one square in any direction (horizontal, vertical, or diagonal). It is restricted to staying within the East Palace.</li>
              <li><span className="text-white px-1 rounded-sm mr-2 font-bold">炮</span> <strong class="font-bold text-white">Cannon</strong>: Moves any number of squares horizontally or vertically. To capture an opponent's piece, it must jump over exactly one piece that can be either White or Black.</li>
            </ul>
          </div>

          <h3 className="text-xl font-bold mb-2">Game End Conditions</h3>
          <ul className="list-disc list-inside mb-4 text-gray-300 space-y-2">
            <li><strong class="font-bold text-white">Checkmate</strong>: The player whose turn it is has no legal moves and their King/General is under attack.</li>
            <li><strong class="font-bold text-white">Stalemate</strong>: The player whose turn it is has no legal moves but their King/General is not under attack. This results in a draw.</li>
            <li><strong class="font-bold text-white">Threefold Repetition</strong>: A draw is declared if the same position occurs three times.</li>
            <li><strong class="font-bold text-white">Fifty-Move Rule</strong>: A draw is declared if no pawn has been moved and no piece has been captured in the last 50 moves (100 half-moves).</li>
            <li><strong class="font-bold text-white">Insufficient Material</strong>: A draw is declared if neither player has enough pieces to force a checkmate.</li>
          </ul>
        </div>
      )}

      {/* Main Board and Game Info Container */}
      <div className="flex flex-col items-center justify-center bg-gray-900 p-6 rounded-xl shadow-2xl">
        <h1 className="text-4xl font-bold text-white mb-6">Qi-Chess</h1>
        <div className="text-white text-xl mb-4 font-semibold">
          {statusMessage}
        </div>
        
        {/* New flex container for the eval bar and board */}
        <div className="flex flex-row items-center space-x-4">
            {/* The evaluation bar is now a direct child of this flex container */}
            <EvalBar score={evaluationScore} />
            
            {/* The board is also a direct child */}
            <div
                ref={boardRef}
                className={`grid gap-0 overflow-hidden border-4 border-gray-700 relative ${isDragging ? 'cursor-grabbing' : ''}`}
                style={{
                    gridTemplateColumns: `repeat(${BOARD_COLS}, ${SQUARE_SIZE_REM}rem)`,
                    gridTemplateRows: `repeat(${BOARD_ROWS}, ${SQUARE_SIZE_REM}rem)`,
                    width: `min-content`,
                    height: `min-content`,
                }}
            >
                {/* Render the board squares and pieces */}
                {board.map((row, rowIndex) => (
                    row.map((pieceChar, colIndex) => {
                        // Determine square color based on the board sections
                        let squareColorClass = '';

                        if (rowIndex === RIVER_ROW_INDEX) {
                            // River area (single row)
                            squareColorClass = 'bg-[#1f3864]'; // Specific hex color for river
                        } else if (rowIndex < RIVER_ROW_INDEX) {
                            // West Territory (top half - rows 0-4)
                            const isLightSquare = (rowIndex + colIndex) % 2 === 0;
                            squareColorClass = isLightSquare ? 'bg-[#c5e0b3]' : 'bg-green-700'; // Specific hex for lighter green
                        } else {
                            // East Territory (bottom half - rows 6-10)
                            const isLightSquare = (rowIndex + colIndex) % 2 === 0;
                            // Swapped light and dark brown for East Territory
                            squareColorClass = isLightSquare ? 'bg-[#f2ba76]' : 'bg-orange-700'; // Reverted: Lighter brown on light, darker on dark
                        }

                        // Palace definitions
                        // These variables are already defined in a higher scope at the top of App component.
                        const isEastPalace = (rowIndex >= eastPalaceMinRow && rowIndex <= eastPalaceMaxRow &&
                            colIndex >= eastPalaceMinCol && colIndex <= eastPalaceMaxCol);

                        let palaceBorderClasses = '';
                        if (isEastPalace) {
                            // Apply borders only to the outer edges of the palace
                            if (rowIndex === eastPalaceMinRow) {
                                palaceBorderClasses += ' border-t-[6px] border-black'; // Thicker border
                            }
                            if (rowIndex === eastPalaceMaxRow) {
                                palaceBorderClasses += ' border-b-[6px] border-black'; // Thicker border
                            }
                            if (colIndex === eastPalaceMinCol) {
                                palaceBorderClasses += ' border-l-[6px] border-black'; // Thicker border
                            }
                            if (colIndex === eastPalaceMaxCol) {
                                palaceBorderClasses += ' border-r-[6px] border-black'; // Thicker border
                            }
                        }

                        const textColor = game.getPieceColor(pieceChar) === 'w' ? 'text-white' : 'text-black';
                        
                        const isMovablePiece = pieceChar !== ' ' && game.getPieceColor(pieceChar) === game.turn && !gameOver;

                        // Check if the current square is a valid legal move destination
                        const isLegalMoveSquare = legalMoves.some(move =>
                            move.to.r === rowIndex && move.to.c === colIndex
                        );
                        
                        return (
                            <div
                                key={`${rowIndex}-${colIndex}`}
                                id={`square-${rowIndex}-${colIndex}`}
                                className={`relative flex items-center justify-center text-xl font-bold rounded-none
                                    ${squareColorClass}
                                    ${palaceBorderClasses}
                                    ${isMovablePiece && currentMoveIndex === boardHistory.length - 1 ? 'cursor-grab' : ''}
                                `}
                                onMouseDown={(event) => {
                                    event.preventDefault(); // Prevent default browser drag behavior
                                    handleMouseDown(pieceChar, rowIndex, colIndex, event);
                                }}
                                // No onMouseUp for individual squares. Global document listener handles all drops.
                                style={{
                                    borderRadius: '0px' // Ensure no rounded corners on individual squares
                                }}
                            >
                                {/* 1. Row Numbers (top left, left-most column) */}
                                {colIndex === 0 && (
                                    <div className="absolute top-0 left-0 p-0.5 text-xs text-gray-600 font-sans z-10">
                                        {BOARD_ROWS - rowIndex}
                                    </div>
                                )}

                                {/* 2. Column Letters (bottom right, bottom-most row) */}
                                {rowIndex === BOARD_ROWS - 1 && (
                                    <div className="absolute bottom-0 right-0 p-0.5 text-xs text-gray-600 font-sans z-10">
                                        {String.fromCharCode(97 + colIndex)}
                                    </div>
                                )}
                                {/* Render the piece directly from the board state */}
                                {/* Conditional Rendering for Unicode vs Image Pieces */}
                                {(() => {
                                    const pieceContent = pieces[pieceChar];
                                    // Check if the content is the SVG path
                                    const isImagePiece = pieceContent === blackPawnImage;

                                    return isImagePiece ? (
                                        <img 
                                            src={pieceContent} 
                                            alt={pieceChar}
                                            className="w-3/5 h-3/5 object-contain drop-shadow-lg"
                                        />
                                    ) : (
                                        <span className={`${textColor} drop-shadow-lg translate-y-[-5%]`}>
                                            {pieceContent}
                                        </span>
                                    );
                                })()}

                                {/* Legal move indicator */}
                                {isLegalMoveSquare && (
                                    <div
                                        className="absolute w-1/2 h-1/2 rounded-full opacity-50"
                                        style={{
                                            backgroundColor: '#fde047',
                                            transform: 'translate(-50%, -50%)',
                                            top: '50%',
                                            left: '50%',
                                        }}
                                    />
                                )}
                            </div>
                        );
                    })
                )).flat()} {/* Flatten the array of arrays to fix React child error */}
                {/* Promotion UI Overlay */}
                {promotionSquare && (
                  <div className="absolute inset-0 bg-black bg-opacity-40 z-50 flex">
                    {/* Vertical promotion menu aligned near the promotion column */}
                    <div
                      className="flex flex-col space-y-2 p-2 bg-gray-800 bg-opacity-90 rounded-r-xl shadow-xl"
                      style={{
                        marginLeft: `${promotionSquare.col * SQUARE_SIZE_REM}rem`,
                        justifyContent: promotionSquare.color === 'w' ? 'flex-start' : 'flex-end',
                        height: '100%',
                      }}
                    >
                      {(promotionSquare.color === 'w'
                        ? ['XR','XN','XB','XA','XC','XS']
                        : ['r','n','b','q','h']).map(piece => (
                        <button
                          key={piece}
                          onClick={() => {
                            game.promotePawn(piece);
                            setPromotionSquare(null);
                            setBoard([...game.board.map(row => [...row])]);
                            setTurn(game.turn);
                          }}
                          className="bg-gray-700 hover:bg-yellow-400 rounded-full w-12 h-12 flex items-center justify-center transition"
                        >
                          <span className="text-white text-2xl drop-shadow-lg">
                            {pieces[piece]}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Draggable Piece "Ghost" */}
                <div
                    ref={draggablePieceRef}
                    className={`absolute flex items-center justify-center text-xl font-bold z-50 pointer-events-none`}
                    style={{
                        width: `${SQUARE_SIZE_REM}rem`,
                        height: `${SQUARE_SIZE_REM}rem`,
                        visibility: isDragging && selectedPiece ? 'visible' : 'hidden',
                        left: '0px',
                        top: '0px',
                    }}
                >
                    {selectedPiece && (() => {
                        const pieceContent = pieces[selectedPiece.piece];
                        const isImagePiece = pieceContent === blackPawnImage;

                        return isImagePiece ? (
                            <img 
                                src={pieceContent} 
                                alt={selectedPiece.piece} 
                                className="w-3/5 h-3/5 object-contain opacity-80 drop-shadow-lg" 
                            />
                        ) : (
                            <span className={`${game.getPieceColor(selectedPiece.piece) === 'w' ? 'text-white' : 'text-black'} drop-shadow-lg opacity-80 translate-y-[-5%]`}>
                                {pieceContent}
                            </span>
                        );
                    })()}
                </div>
            </div>
        </div>
        <div className="mt-6 flex space-x-4">
          <button
            onClick={handleRestartGame}
            className="px-6 py-3 bg-blue-600 text-white font-bold rounded-md shadow-lg
                       hover:bg-blue-700 transition duration-300 ease-in-out
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75"
            aria-label="Restart Game"
          >
            Restart Game
          </button>
          <button
            onClick={handleBotMove}
            disabled={isBotThinking || currentMoveIndex !== boardHistory.length - 1}
            className="px-6 py-3 bg-purple-600 text-white font-bold rounded-md shadow-lg
                       hover:bg-purple-700 transition duration-300 ease-in-out
                       focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-75
                       disabled:bg-gray-500 disabled:cursor-not-allowed"
            aria-label="Bot Move"
          >
            {isBotThinking ? "Bot is moving..." : "Bot Move"}
          </button>
          <button
            onClick={handleSelfPlay}
            disabled={isBotThinking || game.isGameOverFlag}
            className="px-6 py-3 bg-green-600 text-white font-bold rounded-md shadow-lg
                      hover:bg-green-700 transition duration-300 ease-in-out
                      focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-75
                      disabled:bg-gray-500 disabled:cursor-not-allowed"
            aria-label="Bot vs Bot"
          >
            {isBotThinking ? "Bots are playing..." : "Bot vs Bot"}
          </button>
          <button
            onClick={() => { selfPlayActive.current = false; }}
            className="px-6 py-3 bg-red-600 text-white font-bold rounded-md shadow-lg
                      hover:bg-red-700 transition duration-300 ease-in-out
                      focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-75"
            aria-label="Pause Bot vs Bot"
          >
            Pause
          </button>
        </div>
        <p className="text-gray-400 mt-6 text-sm">
          This is a custom chess-like interface with draggable pieces and simplified game logic. It now attempts to implement full stalemate rules conceptually. For a robust and comprehensive chess engine, using a dedicated library like chess.js is highly recommended.
        </p>
      </div>
      
      {/* Move History Sidebar - NEWLY ADDED */}
      <MoveHistory 
        boardHistory={boardHistory} 
        currentMoveIndex={currentMoveIndex}
        toAlgebraic={toAlgebraic}
        getPgnPieceSymbol={getPgnPieceSymbol}
      />
    </div>
  );
};

export default App;