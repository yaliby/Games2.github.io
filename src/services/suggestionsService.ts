import {
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";

export type SuggestionSort = "top" | "new";

export type SuggestionEntry = {
  id: string;
  uid: string;
  username: string;
  text: string;
  imageDataUrl: string | null;
  votesCount: number;
  voters: string[];
  createdAtMs: number;
  updatedAtMs: number;
};

export type VoteSuggestionResult = "voted" | "already-voted";

type SuggestionDocRaw = {
  uid?: unknown;
  username?: unknown;
  text?: unknown;
  imageDataUrl?: unknown;
  votesCount?: unknown;
  voters?: unknown;
  createdAt?: { toMillis?: () => number } | unknown;
  updatedAt?: { toMillis?: () => number } | unknown;
};

function toMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in value) {
    const maybeTimestamp = value as { toMillis?: () => number };
    if (typeof maybeTimestamp.toMillis === "function") {
      return maybeTimestamp.toMillis();
    }
  }
  return 0;
}

function normalizeSuggestion(id: string, raw: SuggestionDocRaw): SuggestionEntry {
  const uid = typeof raw.uid === "string" ? raw.uid : "";
  const username = typeof raw.username === "string" ? raw.username : "Player";
  const text = typeof raw.text === "string" ? raw.text : "";
  const imageDataUrl =
    typeof raw.imageDataUrl === "string" && raw.imageDataUrl.startsWith("data:image/")
      ? raw.imageDataUrl
      : null;
  const votesCountRaw =
    typeof raw.votesCount === "number" && Number.isFinite(raw.votesCount)
      ? Math.max(0, Math.floor(raw.votesCount))
      : 0;
  const voters = Array.isArray(raw.voters)
    ? raw.voters.filter((item): item is string => typeof item === "string")
    : [];

  return {
    id,
    uid,
    username,
    text,
    imageDataUrl,
    votesCount: Math.max(votesCountRaw, voters.length),
    voters,
    createdAtMs: toMillis(raw.createdAt),
    updatedAtMs: toMillis(raw.updatedAt),
  };
}

export function subscribeSuggestions(
  sort: SuggestionSort,
  onRows: (rows: SuggestionEntry[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const source = collection(db, "suggestions");
  const suggestionsQuery =
    sort === "top"
      ? query(source, orderBy("votesCount", "desc"), limit(120))
      : query(source, orderBy("createdAt", "desc"), limit(120));

  return onSnapshot(
    suggestionsQuery,
    (snap) => {
      const rows = snap.docs.map((entry) =>
        normalizeSuggestion(entry.id, entry.data() as SuggestionDocRaw)
      );

      if (sort === "top") {
        rows.sort((a, b) => {
          if (b.votesCount !== a.votesCount) return b.votesCount - a.votesCount;
          return b.createdAtMs - a.createdAtMs;
        });
      }

      onRows(rows);
    },
    (error) => {
      if (onError) onError(error);
    }
  );
}

export async function createSuggestion(payload: {
  uid: string;
  username: string;
  text: string;
  imageDataUrl?: string | null;
}): Promise<void> {
  const trimmed = payload.text.trim();
  if (trimmed.length < 4) {
    throw new Error("suggestion-too-short");
  }

  const cleanImageDataUrl =
    typeof payload.imageDataUrl === "string" && payload.imageDataUrl.startsWith("data:image/")
      ? payload.imageDataUrl
      : null;

  await addDoc(collection(db, "suggestions"), {
    uid: payload.uid,
    username: payload.username,
    text: trimmed,
    ...(cleanImageDataUrl ? { imageDataUrl: cleanImageDataUrl } : {}),
    votesCount: 0,
    voters: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function voteSuggestionOnce(
  suggestionId: string,
  voterUid: string
): Promise<VoteSuggestionResult> {
  const suggestionRef = doc(db, "suggestions", suggestionId);

  return runTransaction(db, async (tx) => {
    const suggestionSnap = await tx.get(suggestionRef);
    if (!suggestionSnap.exists()) {
      throw new Error("suggestion-not-found");
    }

    const raw = suggestionSnap.data() as SuggestionDocRaw;
    const voters = Array.isArray(raw.voters)
      ? raw.voters.filter((item): item is string => typeof item === "string")
      : [];
    if (voters.includes(voterUid)) {
      return "already-voted";
    }

    const votesCountBase =
      typeof raw.votesCount === "number" && Number.isFinite(raw.votesCount)
        ? Math.max(0, Math.floor(raw.votesCount))
        : voters.length;

    tx.update(suggestionRef, {
      votesCount: votesCountBase + 1,
      voters: arrayUnion(voterUid),
      updatedAt: serverTimestamp(),
    });

    return "voted";
  });
}

export async function deleteSuggestion(suggestionId: string): Promise<void> {
  await deleteDoc(doc(db, "suggestions", suggestionId));
}
