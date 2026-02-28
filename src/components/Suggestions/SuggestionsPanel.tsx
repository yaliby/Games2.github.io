import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../services/firebase";
import { compressImageFileToDataUrl, pickImageFileFromClipboard } from "../../services/imagePaste";
import {
  createSuggestion,
  deleteSuggestion,
  subscribeSuggestions,
  voteSuggestionOnce,
  type SuggestionEntry,
  type SuggestionSort,
} from "../../services/suggestionsService";
import "./SuggestionsPanel.css";

type ActiveUser = {
  uid: string;
  username: string;
} | null;

const MAX_SUGGESTION_LENGTH = 600;

function formatSuggestionDate(createdAtMs: number): string {
  if (!createdAtMs) return "עכשיו";
  return new Date(createdAtMs).toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function mutateBusySet(prev: Set<string>, id: string, busy: boolean): Set<string> {
  const next = new Set(prev);
  if (busy) next.add(id);
  else next.delete(id);
  return next;
}

export default function SuggestionsPanel() {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState<SuggestionSort>("top");
  const [rows, setRows] = useState<SuggestionEntry[]>([]);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [feedError, setFeedError] = useState("");
  const [user, setUser] = useState<ActiveUser>(null);

  const [text, setText] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [busyVoteIds, setBusyVoteIds] = useState<Set<string>>(new Set());
  const [busyDeleteIds, setBusyDeleteIds] = useState<Set<string>>(new Set());
  const [headerHeight, setHeaderHeight] = useState(72);

  useEffect(() => {
    let disposed = false;
    const unsub = onAuthStateChanged(auth, async (current) => {
      if (!current) {
        if (!disposed) setUser(null);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", current.uid));
        if (disposed) return;
        const usernameRaw = snap.exists() ? snap.data().username : "";
        const username =
          typeof usernameRaw === "string" && usernameRaw.trim().length > 0
            ? usernameRaw
            : "Player";
        setUser({ uid: current.uid, username });
      } catch (error) {
        if (disposed) return;
        console.warn("suggestions user profile fetch failed:", error);
        setUser({ uid: current.uid, username: "Player" });
      }
    });

    return () => {
      disposed = true;
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setLoadingFeed(true);
    setFeedError("");
    const unsub = subscribeSuggestions(
      sort,
      (nextRows) => {
        setRows(nextRows);
        setLoadingFeed(false);
      },
      (error) => {
        console.warn("suggestions feed listener failed:", error);
        setFeedError("טעינת הצעות נכשלה. בדוק הרשאות/חיבור ונסה שוב.");
        setLoadingFeed(false);
      }
    );

    return () => unsub();
  }, [open, sort]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    const MIN_HEADER_HEIGHT = 56;

    const measure = () => {
      const header = document.querySelector<HTMLElement>('header[data-site-header="main"]');
      if (!header) {
        setHeaderHeight(MIN_HEADER_HEIGHT);
        return;
      }
      const nextHeight = Math.max(MIN_HEADER_HEIGHT, Math.ceil(header.getBoundingClientRect().height));
      setHeaderHeight(nextHeight);
    };

    measure();
    window.addEventListener("resize", measure);

    const header = document.querySelector<HTMLElement>('header[data-site-header="main"]');
    let ro: ResizeObserver | null = null;
    if (header) {
      ro = new ResizeObserver(() => measure());
      ro.observe(header);
    }

    return () => {
      window.removeEventListener("resize", measure);
      if (ro) ro.disconnect();
    };
  }, []);

  const textLength = text.trim().length;
  const canSend = Boolean(user) && textLength >= 4 && !sending;
  const sortedRows = useMemo(() => rows, [rows]);
  const layerStyle = useMemo(
    () =>
      ({
        "--suggestions-header-offset": `${headerHeight}px`,
      }) as CSSProperties,
    [headerHeight]
  );

  const submitSuggestion = async () => {
    if (!user) {
      setActionError("צריך להתחבר כדי לשלוח הצעה.");
      return;
    }

    const cleanText = text.trim();
    if (cleanText.length < 4) {
      setActionError("נא לכתוב לפחות 4 תווים.");
      return;
    }

    setSending(true);
    setActionError("");
    setInfoMessage("");
    try {
      await createSuggestion({
        uid: user.uid,
        username: user.username,
        text: cleanText,
        imageDataUrl,
      });
      setText("");
      setImageDataUrl(null);
      setInfoMessage("ההצעה פורסמה בהצלחה.");
    } catch (error) {
      console.warn("suggestion submit failed:", error);
      setActionError("שליחה נכשלה. נסה שוב בעוד רגע.");
    } finally {
      setSending(false);
    }
  };

  const handleComposerPaste = async (event: ClipboardEvent) => {
    const imageFile = pickImageFileFromClipboard(event.clipboardData);
    if (!imageFile) return;
    event.preventDefault();
    setActionError("");
    setInfoMessage("");
    setImageBusy(true);
    try {
      const nextImageDataUrl = await compressImageFileToDataUrl(imageFile);
      setImageDataUrl(nextImageDataUrl);
      setInfoMessage("תמונה הודבקה בהצלחה.");
    } catch (error) {
      console.warn("suggestions image paste failed:", error);
      setActionError("לא הצלחנו לעבד את התמונה. נסה תמונה קטנה יותר.");
    } finally {
      setImageBusy(false);
    }
  };

  const handleVote = async (entry: SuggestionEntry) => {
    if (!user) {
      setActionError("צריך להתחבר כדי להצביע.");
      return;
    }

    if (entry.voters.includes(user.uid)) {
      setInfoMessage("כבר הצבעת להצעה הזו.");
      return;
    }

    setActionError("");
    setInfoMessage("");
    setBusyVoteIds((prev) => mutateBusySet(prev, entry.id, true));
    try {
      const result = await voteSuggestionOnce(entry.id, user.uid);
      if (result === "already-voted") {
        setInfoMessage("כבר הצבעת להצעה הזו.");
      }
    } catch (error) {
      console.warn("suggestion vote failed:", error);
      setActionError("ההצבעה נכשלה. נסה שוב.");
    } finally {
      setBusyVoteIds((prev) => mutateBusySet(prev, entry.id, false));
    }
  };

  const handleDelete = async (entry: SuggestionEntry) => {
    if (!user || user.uid !== entry.uid) return;
    if (!window.confirm("למחוק את ההצעה הזאת?")) return;

    setActionError("");
    setInfoMessage("");
    setBusyDeleteIds((prev) => mutateBusySet(prev, entry.id, true));
    try {
      await deleteSuggestion(entry.id);
    } catch (error) {
      console.warn("suggestion delete failed:", error);
      setActionError("מחיקה נכשלה. ייתכן שאין הרשאה.");
    } finally {
      setBusyDeleteIds((prev) => mutateBusySet(prev, entry.id, false));
    }
  };

  return (
    <>
      <button
        type="button"
        className="suggestions-fab"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="suggestions-drawer"
        onClick={() => setOpen((prev) => !prev)}
      >
        💡 הצעות
      </button>

      <div
        className={`suggestions-overlay ${open ? "is-open" : ""}`}
        style={layerStyle}
        onClick={() => setOpen(false)}
        aria-hidden={!open}
      />

      <aside
        id="suggestions-drawer"
        className={`suggestions-drawer ${open ? "is-open" : ""}`}
        style={layerStyle}
        role="dialog"
        aria-modal="true"
        aria-label="הצעות לשיפור"
      >
        <div className="suggestions-drawer__header">
          <div>
            <h3 className="suggestions-drawer__title">הצעות לשיפור</h3>
            <p className="suggestions-drawer__subtitle">מעלים רעיון, מצביעים, ודוחפים פיצ'רים קדימה.</p>
          </div>

          <button
            type="button"
            className="suggestions-close-btn"
            aria-label="סגירת פאנל הצעות"
            onClick={() => setOpen(false)}
          >
            ×
          </button>
        </div>

        <div className="suggestions-controls">
          <label htmlFor="suggestions-sort" className="suggestions-controls__label">
            מיון
          </label>
          <select
            id="suggestions-sort"
            className="suggestions-controls__select"
            value={sort}
            onChange={(event) => setSort(event.target.value as SuggestionSort)}
          >
            <option value="top">הכי נתמכים</option>
            <option value="new">הכי חדשים</option>
          </select>
        </div>

        <div className="suggestions-composer">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, MAX_SUGGESTION_LENGTH))}
            onPaste={(event) => {
              void handleComposerPaste(event.nativeEvent);
            }}
            className="suggestions-composer__textarea"
            placeholder="מה היית רוצה לשפר באתר?"
            rows={4}
          />
          {imageDataUrl && (
            <div className="suggestions-composer__image-wrap">
              <img className="suggestions-composer__image" src={imageDataUrl} alt="תמונה שהודבקה להצעה" />
              <button
                type="button"
                className="suggestions-composer__image-remove"
                onClick={() => setImageDataUrl(null)}
              >
                הסר תמונה
              </button>
            </div>
          )}
          <div className="suggestions-composer__actions">
            <span className="suggestions-composer__counter">{textLength}/{MAX_SUGGESTION_LENGTH}</span>
            <button
              type="button"
              className="suggestions-composer__submit"
              onClick={submitSuggestion}
              disabled={!canSend || imageBusy}
            >
              {sending ? "שולח..." : imageBusy ? "מעבד תמונה..." : "פרסם הצעה"}
            </button>
          </div>
          {!user && <div className="suggestions-composer__hint">יש להתחבר כדי לשלוח הצעות ולהצביע.</div>}
          {actionError && <div className="suggestions-composer__error">{actionError}</div>}
          {infoMessage && <div className="suggestions-composer__info">{infoMessage}</div>}
        </div>

        <div className="suggestions-feed">
          {loadingFeed && <div className="suggestions-feed__state">טוען הצעות...</div>}
          {!loadingFeed && feedError && <div className="suggestions-feed__state is-error">{feedError}</div>}
          {!loadingFeed && !feedError && sortedRows.length === 0 && (
            <div className="suggestions-feed__state">אין עדיין הצעות. זה הזמן שלך לפתוח את הרשימה.</div>
          )}

          {!loadingFeed &&
            !feedError &&
            sortedRows.map((entry) => {
              const userVoted = Boolean(user && entry.voters.includes(user.uid));
              const voteBusy = busyVoteIds.has(entry.id);
              const deleteBusy = busyDeleteIds.has(entry.id);
              const owner = Boolean(user && user.uid === entry.uid);

              return (
                <article key={entry.id} className="suggestions-item">
                  <p className="suggestions-item__text">{entry.text}</p>
                  {entry.imageDataUrl && (
                    <img
                      className="suggestions-item__image"
                      src={entry.imageDataUrl}
                      alt="תמונה מצורפת להצעה"
                    />
                  )}
                  <div className="suggestions-item__meta">
                    <span className="suggestions-item__user">{entry.username}</span>
                    <span className="suggestions-item__time">{formatSuggestionDate(entry.createdAtMs)}</span>
                  </div>
                  <div className="suggestions-item__actions">
                    <button
                      type="button"
                      className={`suggestions-item__vote-btn ${userVoted ? "is-voted" : ""}`}
                      onClick={() => {
                        void handleVote(entry);
                      }}
                      disabled={!user || userVoted || voteBusy}
                    >
                      {userVoted ? "הצבעת" : voteBusy ? "..." : "בעד"}
                    </button>
                    <span className="suggestions-item__votes">{entry.votesCount} קולות</span>

                    {owner && (
                      <button
                        type="button"
                        className="suggestions-item__delete-btn"
                        onClick={() => {
                          void handleDelete(entry);
                        }}
                        disabled={deleteBusy}
                      >
                        {deleteBusy ? "מוחק..." : "מחק"}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
        </div>
      </aside>
    </>
  );
}
