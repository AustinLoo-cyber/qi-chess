import React, { useState } from "react";
import { ensureSignedIn } from "./firebase";
import { findOrCreateQuickMatch, createFriendRoom, joinFriendRoom, listenToRoom } from "./multiplayer";

// Modal for starting an online game. Handles three internal screens:
// 'choice'   - Quick Match vs Play a Friend buttons
// 'waiting'  - "Looking for opponent..." or "Share this code..." spinner screen
// (on success, calls onMatched(roomId, color, uid) and the parent closes this modal)
export default function PlayOnlineModal({ onClose, onMatched }) {
  const [screen, setScreen] = useState("choice"); // 'choice' | 'friend-menu' | 'waiting'
  const [waitingLabel, setWaitingLabel] = useState("");
  const [roomCodeToShow, setRoomCodeToShow] = useState(null);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [colorChoice, setColorChoice] = useState("random"); // 'white' | 'black' | 'random'

  // Once matched (as either color), listen for the room becoming 'active'
  // (i.e. an opponent has joined) before handing off to the parent.
  const waitForOpponentThenHandOff = (roomId, color, uid) => {
    const unsubscribe = listenToRoom(roomId, (data) => {
      if (data.status === "active" && data.players.white && data.players.black) {
        unsubscribe();
        onMatched(roomId, color, uid);
      }
    });
  };

  const handleQuickMatch = async () => {
    setIsBusy(true);
    setErrorMsg("");
    try {
      const uid = await ensureSignedIn();
      const { roomId, color } = await findOrCreateQuickMatch(uid, colorChoice);
      if (color === "b") {
        // We just claimed an existing waiting room, so the game is already active.
        onMatched(roomId, color, uid);
      } else {
        // We created a fresh room and now wait for someone else to join.
        setWaitingLabel("Looking for an opponent...");
        setScreen("waiting");
        waitForOpponentThenHandOff(roomId, color, uid);
      }
    } catch (err) {
      console.error(err);
      setErrorMsg("Something went wrong finding a match. Please try again.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateFriendRoom = async () => {
    setIsBusy(true);
    setErrorMsg("");
    try {
      const uid = await ensureSignedIn();
      const { roomId, color } = await createFriendRoom(uid, colorChoice);
      setRoomCodeToShow(roomId);
      setWaitingLabel("Share this code with your friend:");
      setScreen("waiting");
      waitForOpponentThenHandOff(roomId, color, uid);
    } catch (err) {
      console.error(err);
      setErrorMsg("Couldn't create a room. Please try again.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleJoinFriendRoom = async () => {
    if (!joinCodeInput.trim()) return;
    setIsBusy(true);
    setErrorMsg("");
    try {
      const uid = await ensureSignedIn();
      const { roomId, color } = await joinFriendRoom(uid, joinCodeInput);
      // Joining a friend's room means it's already active immediately.
      onMatched(roomId, color, uid);
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || "Couldn't join that room.");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[100] p-4">
      <div className="bg-gray-800 text-white rounded-xl shadow-2xl w-full max-w-sm p-5 sm:p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-400 hover:text-white text-xl leading-none"
          aria-label="Close"
        >
          &times;
        </button>

        {screen === "choice" && (
          <>
            <h2 className="text-xl sm:text-2xl font-bold mb-4">Play Online</h2>

            <div className="mb-4">
              <div className="text-sm text-gray-400 mb-2">Play as</div>
              <div className="flex gap-2">
                {[
                  { value: "white", label: "White" },
                  { value: "black", label: "Black" },
                  { value: "random", label: "Random" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setColorChoice(opt.value)}
                    className={`flex-1 px-2 py-2 text-sm rounded-md font-semibold transition border-2 ${
                      colorChoice === opt.value
                        ? "bg-teal-600 border-teal-400 text-white"
                        : "bg-gray-700 border-transparent text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={handleQuickMatch}
                disabled={isBusy}
                className="px-4 py-3 bg-blue-600 hover:bg-blue-700 rounded-md font-bold transition disabled:opacity-50"
              >
                Quick Match
              </button>
              <button
                onClick={() => setScreen("friend-menu")}
                disabled={isBusy}
                className="px-4 py-3 bg-green-600 hover:bg-green-700 rounded-md font-bold transition disabled:opacity-50"
              >
                Play a Friend
              </button>
            </div>
          </>
        )}

        {screen === "friend-menu" && (
          <>
            <h2 className="text-xl sm:text-2xl font-bold mb-4">Play a Friend</h2>
            <div className="text-xs text-gray-400 mb-3">
              Your color choice ({colorChoice === "random" ? "Random" : colorChoice === "white" ? "White" : "Black"}) applies if you create a room. Joining a friend's room gives you whichever color they didn't take.
            </div>
            <button
              onClick={handleCreateFriendRoom}
              disabled={isBusy}
              className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 rounded-md font-bold transition mb-4 disabled:opacity-50"
            >
              Create a Room
            </button>

            <div className="text-center text-gray-400 text-sm mb-3">or join one</div>

            <div className="flex gap-2">
              <input
                type="text"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value)}
                placeholder="Enter room code"
                maxLength={6}
                className="flex-1 px-3 py-2 rounded-md bg-gray-700 text-white uppercase tracking-widest placeholder:normal-case placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                onClick={handleJoinFriendRoom}
                disabled={isBusy || !joinCodeInput.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md font-bold transition disabled:opacity-50"
              >
                Join
              </button>
            </div>

            <button
              onClick={() => setScreen("choice")}
              className="mt-4 text-sm text-gray-400 hover:text-white"
            >
              &larr; Back
            </button>
          </>
        )}

        {screen === "waiting" && (
          <div className="text-center py-4">
            <h2 className="text-xl font-bold mb-4">{waitingLabel}</h2>
            {roomCodeToShow && (
              <div className="text-3xl font-mono font-bold tracking-widest bg-gray-700 rounded-md py-3 mb-4 select-all">
                {roomCodeToShow}
              </div>
            )}
            <div className="flex justify-center mb-4">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
            <button
              onClick={() => { setScreen("choice"); setRoomCodeToShow(null); }}
              className="text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 text-red-400 text-sm text-center">{errorMsg}</div>
        )}
      </div>
    </div>
  );
}