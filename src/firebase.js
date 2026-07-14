// Firebase setup for online multiplayer.
// This file only handles the *connection* to Firebase — matchmaking and
// move-syncing logic will live in their own files/components.

import { initializeApp } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDuqmtYIhdu1GLoIR1sAOz6GQITOE0UwU4",
  authDomain: "qi-chess.firebaseapp.com",
  projectId: "qi-chess",
  storageBucket: "qi-chess.firebasestorage.app",
  messagingSenderId: "799221520921",
  appId: "1:799221520921:web:04ee4a4181d1109fa5e888",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Firestore: this is the real-time database that will hold game rooms.
// experimentalAutoDetectLongPolling helps players whose ad blockers or
// privacy extensions block Firestore's normal streaming connection — it
// automatically falls back to a more compatible connection method instead
// of just failing silently.
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
});

// Auth: every visitor gets signed in anonymously, so we can tell
// "you" apart from "your opponent" in a game room without a login screen.
export const auth = getAuth(app);

/**
 * Ensures the current visitor is signed in (anonymously) and returns their
 * unique user ID once ready. Safe to call multiple times.
 * Usage: const uid = await ensureSignedIn();
 */
export function ensureSignedIn() {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      if (user) {
        resolve(user.uid);
      } else {
        signInAnonymously(auth)
          .then((result) => resolve(result.user.uid))
          .catch(reject);
      }
    });
  });
}