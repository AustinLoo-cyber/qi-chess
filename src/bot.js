// src/bot.js

export function getBotMove(boardState, legalMoves, color, boardHistory, searchDepth = 3, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    // Create the worker as a module (important for ES6 imports inside botWorker.js)
    const worker = new Worker(new URL('./botWorker.js', import.meta.url), { type: 'module' });

    // Normalize board to make sure it's serializable
    const safeBoard = boardState.map(row =>
      row.map(cell => (cell == null ? ' ' : cell))
    );

    // Send payload to worker
    worker.postMessage({
      boardState: safeBoard,
      legalMoves,
      color,
      boardHistory, // Pass the board history to the worker
      positionHistory: boardHistory,
      searchDepth,
    });

    // Listen for worker response
    worker.onmessage = (ev) => {
      const result = ev.data;
      if (result && result.__error) {
        reject(new Error(`Bot error: ${result.__error}`));
      } else {
        resolve(result);
      }
      worker.terminate();
    };

    // Handle worker errors
    worker.onerror = (err) => {
      reject(err);
      worker.terminate();
    };

    // Optional timeout
    if (timeoutMs > 0) {
      setTimeout(() => {
        reject(new Error("Bot worker timed out"));
        worker.terminate();
      }, timeoutMs);
    }
  });
}