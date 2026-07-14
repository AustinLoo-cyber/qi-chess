import React from "react";

// Convert evaluation score into percentage (0% = all Black, 100% = all White)
function evalToPercentage(score) {
  if (score > 1000) return 100; // White is completely winning
  if (score < -1000) return 0; // Black is completely winning
  return 50 + score / 20; // scale score into a reasonable 0–100 range
}

// Format the score for display, e.g., +2.4 or -3.1
function formatScore(score) {
  if (score === Infinity) return "M1";
  if (score === -Infinity) return "-M1";
  const formatted = (score / 100).toFixed(1);
  return score > 0 ? `+${formatted}` : formatted;
}

export default function EvalBar({ score }) {
  const percent = Math.max(0, Math.min(100, evalToPercentage(score)));
  const formattedScore = formatScore(score);

  return (
    <div className="relative h-[32.34rem] w-[1.815rem] flex flex-col border-2 border-gray-600 rounded overflow-hidden z-20">
      {/* Black advantage fills from top */}
      <div
        className="bg-black transition-all duration-300 ease-in-out"
        style={{ height: `${100 - percent}%` }}
      ></div>
      {/* White advantage fills from bottom */}
      <div
        className="bg-white transition-all duration-300 ease-in-out"
        style={{ height: `${percent}%` }}
      ></div>

      {/* Score Text */}
      <span
        className={`absolute text-center w-full ${
          score < 0 ? "top-2 text-white" : "bottom-2 text-gray-800"
        } text-[0.6rem] font-normal z-30`}
      >
        {formattedScore}
      </span>
    </div>
  );
}