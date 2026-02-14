import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  deleteUser,            // 👈 זה החסר
} from "firebase/auth";

import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "./firebase";

// המרה פנימית
const usernameToEmail = (username: string) =>
  `${username.toLowerCase()}@blockblaster.local`;

export async function register(username: string, password: string) {
  const email = usernameToEmail(username);

  const usernameRef = doc(db, "usernames", username);
  if ((await getDoc(usernameRef)).exists()) {
    throw new Error("Username already taken");
  }

  let uid: string | null = null;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    uid = cred.user.uid;

    await setDoc(doc(db, "users", uid), {
      username,
      bestScore: 0,
      gamesPlayed: 0,
      createdAt: serverTimestamp(),
    });

    await setDoc(usernameRef, { uid });
    return uid;
  } catch (err) {
    if (uid) {
      await deleteUser(auth.currentUser!);
    }
    throw err;
  }
}


export async function login(
  username: string,
  password: string
) {
  const email = usernameToEmail(username);
  await signInWithEmailAndPassword(auth, email, password);
}
