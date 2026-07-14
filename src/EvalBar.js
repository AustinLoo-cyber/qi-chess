import React from "react";

// Convert evaluation score into percentage (0% = all Black, 100% = all White)
// Uses a logistic curve instead of a flat linear scale: small/medium advantages
// (a piece or two, ~100-500 points here) are clearly visible, while very large
// or mate-level scores smoothly saturate toward 0%/100% rather than clipping hard.
function evalToPercentage(score) {
  if (score === Infinity) return 100;
  if (score === -Infinity) return 0;
  const K = 350; // controls how quickly the curve saturates; lower = more sensitive
  return 100 / (1 + Math.exp(-score / K));
}

// Format the score for display, e.g., +2.4 or -3.1
function formatScore(score) {
  if (score === Infinity) return "M1";
  if (score === -Infinity) return "-M1";
  const formatted = (score / 100).toFixed(1);
  return score > 0 ? `+${formatted}` : formatted;
}

export default function EvalBar({ score, squareSizeCss, boardRows }) {
  const percent = Math.max(0, Math.min(100, evalToPercentage(score)));
  const formattedScore = formatScore(score);

  // Fall back to the old fixed size if no props are passed (keeps component safe to reuse elsewhere)
  const barHeight = squareSizeCss && boardRows
    ? `calc(${squareSizeCss} * ${boardRows})`
    : '32.34rem';
  const barWidth = squareSizeCss
    ? `calc(${squareSizeCss} * 0.62)`
    : '1.815rem';

  return (
    <div
      className="relative flex flex-col border-2 border-gray-600 rounded overflow-hidden z-20"
      style={{ height: barHeight, width: barWidth }}
    >
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
          score < 0 ? "text-white" : "text-gray-800"
        } font-normal z-30`}
        style={{
          fontSize: squareSizeCss ? `calc(${squareSizeCss} * 0.2)` : '0.6rem',
          top: score < 0 ? (squareSizeCss ? `calc(${squareSizeCss} * 0.15)` : '0.5rem') : 'auto',
          bottom: score < 0 ? 'auto' : (squareSizeCss ? `calc(${squareSizeCss} * 0.15)` : '0.5rem'),
        }}
      >
        {formattedScore}
      </span>
    </div>
  );
}