// Matchmaking and game-room logic for online multiplayer.
// This file only handles finding/creating a room and reading/writing its
// state in Firestore. The actual move-syncing into the game UI happens
// in App.js, which will use these functions.

import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  onSnapshot,
  collection,
  query,
  where,
  limit,
  getDocs,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { ChessGame } from "./game";

const ROOMS_COLLECTION = "rooms";

// Firestore does not support arrays-of-arrays (a "nested array"), and your
// board is exactly that — rows of columns. These helpers flatten a board to
// a JSON string for storage, and parse it back on the way out. boardHistory
// (an array of boards) becomes an array of these JSON strings, which IS
// fine in Firestore since it's just an array of strings, not of arrays.
function serializeBoard(board) {
  return JSON.stringify(board);
}
function deserializeBoard(serialized) {
  return JSON.parse(serialized);
}
export function deserializeBoardHistory(serializedHistory) {
  return serializedHistory.map(deserializeBoard);
}
export { deserializeBoard };

// Generates a short, human-typeable room code, e.g. "X7K2QP".
// Excludes visually-confusing characters like 0/O and 1/I.
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Resolves a user's color preference ('white' | 'black' | 'random') into
// an actual 'w' or 'b' assignment.
function resolveColor(preferredColor) {
  if (preferredColor === "white") return "w";
  if (preferredColor === "black") return "b";
  return Math.random() < 0.5 ? "w" : "b"; // 'random' or anything unrecognized
}

// Builds the initial room document, reusing ChessGame's own setup so the
// starting position always matches your actual game rules. hostColor is
// whichever color the room's creator will play ('w' or 'b') — the other
// color slot starts empty, waiting for an opponent to claim it.
function buildInitialRoomData(hostUid, mode, hostColor) {
  const freshGame = new ChessGame();
  return {
    mode, // 'quick' or 'friend'
    status: "waiting", // 'waiting' | 'active' | 'finished'
    players: {
      white: hostColor === "w" ? hostUid : null,
      black: hostColor === "b" ? hostUid : null,
    },
    board: serializeBoard(freshGame.board),
    boardHistory: [serializeBoard(freshGame.board)],
    currentMoveIndex: 0,
    turn: "w",
    statusMessage: freshGame.statusMessage || "White to move",
    createdAt: serverTimestamp(),
    lastMoveAt: serverTimestamp(),
  };
}

/**
 * Quick Match: tries to join an existing open room whose open color slot
 * matches your preference; if none exists, creates a new room with your
 * chosen (or randomly assigned) color.
 * preferredColor: 'white' | 'black' | 'random'
 * Returns { roomId, color } where color is 'w' or 'b'.
 */
export async function findOrCreateQuickMatch(uid, preferredColor = "random") {
  // 'random' means "I'll take whichever room is available" — no filtering needed.
  const desiredColor = preferredColor === "random" ? null : resolveColor(preferredColor);

  const roomsRef = collection(db, ROOMS_COLLECTION);
  const q = query(
    roomsRef,
    where("mode", "==", "quick"),
    where("status", "==", "waiting"),
    limit(10) // check a few in case some get claimed or don't match our color preference
  );
  const snapshot = await getDocs(q);

  for (const docSnap of snapshot.docs) {
    const roomId = docSnap.id;
    const data = docSnap.data();
    const openColor = !data.players.white ? "w" : (!data.players.black ? "b" : null);
    if (!openColor) continue; // shouldn't happen for a 'waiting' room, but guard anyway
    if (desiredColor && openColor !== desiredColor) continue; // doesn't match what we want, skip it

    const claimedColor = await tryClaimOpenSlot(roomId, uid, openColor);
    if (claimedColor) {
      return { roomId, color: claimedColor };
    }
    // If claiming failed (someone else got there first), just try the next candidate.
  }

  // No suitable open room available — create a new one with our chosen color.
  const hostColor = desiredColor || resolveColor("random");
  const newRoomId = generateRoomCode();
  await setDoc(doc(db, ROOMS_COLLECTION, newRoomId), buildInitialRoomData(uid, "quick", hostColor));
  return { roomId: newRoomId, color: hostColor };
}

/**
 * Play a Friend: creates a fresh room with a specific shareable code, with
 * you playing the given (or randomly assigned) color.
 * preferredColor: 'white' | 'black' | 'random'
 * Returns { roomId, color }.
 */
export async function createFriendRoom(uid, preferredColor = "random") {
  const hostColor = resolveColor(preferredColor);
  // Extremely unlikely to collide, but check anyway and retry if it does.
  let roomId = generateRoomCode();
  let existing = await getDoc(doc(db, ROOMS_COLLECTION, roomId));
  while (existing.exists()) {
    roomId = generateRoomCode();
    existing = await getDoc(doc(db, ROOMS_COLLECTION, roomId));
  }
  await setDoc(doc(db, ROOMS_COLLECTION, roomId), buildInitialRoomData(uid, "friend", hostColor));
  return { roomId, color: hostColor };
}

/**
 * Play a Friend: joins a room using the code your friend shared with you.
 * You automatically get whichever color your friend didn't take — there's
 * no color choice here, since only one slot is left open.
 * Returns { roomId, color } on success, or throws an Error with a
 * user-facing message on failure (room not found / already full).
 */
export async function joinFriendRoom(uid, roomCode) {
  const roomId = roomCode.trim().toUpperCase();
  const roomRef = doc(db, ROOMS_COLLECTION, roomId);
  const roomSnap = await getDoc(roomRef);
  if (!roomSnap.exists()) {
    throw new Error("That room code doesn't exist — double check it with your friend.");
  }
  const data = roomSnap.data();
  const openColor = !data.players.white ? "w" : (!data.players.black ? "b" : null);
  if (!openColor) {
    throw new Error("That room is already full.");
  }
  const claimedColor = await tryClaimOpenSlot(roomId, uid, openColor);
  if (!claimedColor) {
    throw new Error("That room code isn't available — check the code, or it may already be full.");
  }
  return { roomId, color: claimedColor };
}

// Shared helper: atomically claims a specific open color slot in a waiting
// room. Returns the claimed color ('w'/'b') on success, or null if the
// room doesn't exist / isn't waiting / that slot was already taken by
// someone else in the meantime.
async function tryClaimOpenSlot(roomId, uid, expectedOpenColor) {
  const roomRef = doc(db, ROOMS_COLLECTION, roomId);
  const colorField = expectedOpenColor === "w" ? "white" : "black";
  try {
    return await runTransaction(db, async (transaction) => {
      const roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists()) return null;
      const data = roomSnap.data();
      if (data.status !== "waiting" || data.players[colorField]) return null;
      transaction.update(roomRef, {
        [`players.${colorField}`]: uid,
        status: "active",
      });
      return expectedOpenColor;
    });
  } catch (err) {
    console.error("Failed to claim room slot:", err);
    return null;
  }
}

/**
 * Subscribes to real-time updates for a room. Calls onUpdate(data) every
 * time the room document changes (opponent moves, opponent joins, etc).
 * NOTE: data.board and data.boardHistory come back as JSON strings (see
 * deserializeBoard/deserializeBoardHistory above) — deserialize them
 * before using them as actual board arrays.
 * Returns an unsubscribe function — call it when leaving the room/unmounting.
 */
export function listenToRoom(roomId, onUpdate) {
  const roomRef = doc(db, ROOMS_COLLECTION, roomId);
  return onSnapshot(roomRef, (docSnap) => {
    if (docSnap.exists()) {
      onUpdate(docSnap.data());
    }
  });
}

/**
 * Writes a new move/board state to the room after a player moves.
 * boardHistory/currentMoveIndex/turn/statusMessage mirror the same fields
 * your local game already tracks, so the sync stays simple.
 */
export async function submitMoveToRoom(roomId, { board, boardHistory, currentMoveIndex, turn, statusMessage, gameOver }) {
  const roomRef = doc(db, ROOMS_COLLECTION, roomId);
  await updateDoc(roomRef, {
    board: serializeBoard(board),
    boardHistory: boardHistory.map(serializeBoard),
    currentMoveIndex,
    turn,
    statusMessage,
    status: gameOver ? "finished" : "active",
    lastMoveAt: serverTimestamp(),
  });
}