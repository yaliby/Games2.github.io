﻿import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "../services/firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../services/firebase";
import UserBox from "./UserBox/UserBox";
import { isAdminUid } from "../services/admin";
import { HOURLY_MAGIC_OPEN_EVENT } from "./HourlyMagicPrompt";

type UserInfo = {
  uid: string;
  username: string;
  isAdmin: boolean;
} | null;

type UpdateItem = {
  date: string;
  title: string;
  desc: string;
  tag: string;
  details?: string[];
};

type FeedbackKind = "bug" | "idea" | "other";

type FeedbackEntry = {
  id: string;
  uid: string;
  username: string;
  kind: FeedbackKind;
  text: string;
  createdAtMs: number;
};

function formatFeedbackTime(createdAtMs: number) {
  if (!createdAtMs) return "עכשיו";
  return new Date(createdAtMs).toLocaleString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
}

export default function Header() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserInfo>(null);
  const [loading, setLoading] = useState(true);

  // Letter modal
  const [letterOpen, setLetterOpen] = useState(false);
  // Updates modal
  const [updatesOpen, setUpdatesOpen] = useState(false);
  // Feedback modal
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>("bug");
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEntry[]>([]);

  const updatesLog: UpdateItem[] = [
    {
      date: "14.02.2026",
      title: "תוקנו באגים בכל המשחקים",
      desc: "בוצעו תיקוני יציבות ותיקוני באגים רוחביים בכל המשחקים בפלטפורמה.",
      tag: "Fixes",
      details: [
        "תוקנו תקלות תצוגה, ניקוד ומעברי סיבובים במספר משחקים.",
        "שופרו ביצועים במסכים עמוסים ורינדור רכיבים כבדים.",
        "בוצעו תיקוני UX ושגיאות שגרמו להתנהגות לא עקבית.",
      ],
    },
    {
      date: "14.02.2026",
      title: "נוספו פודיומים למשחקים",
      desc: "נוספה תצוגת פודיום במשחקים לתוצאות ולמובילים.",
      tag: "Leaderboard",
      details: [
        "הפודיום מציג מובילים בצורה ברורה ונגישה יותר.",
        "שופר הסדר בין הישגים, ניקוד ומיקום בשחקנים מובילים.",
      ],
    },
    {
      date: "14.02.2026",
      title: "נוספו משחקים חדשים",
      desc: "נוספו המשחק של המדינות וגם המשחק של הרוסית (Sound Shooter).",
      tag: "Games",
      details: [
        "Which Country: משחק לימודי לזיהוי מדינות בעולם.",
        "Sound Shooter: משחק לימוד פונטיקה ואותיות ברוסית.",
      ],
    },
    {
      date: "07.02.2026",
      title: "לוג עדכונים מעודכן",
      desc: "המסך מציג כעת את השיפורים האחרונים בצורה ברורה וקלה לקריאה.",
      tag: "Updates",
    },
    {
      date: "06.02.2026",
      title: "שדרוג בוטים",
      desc: "בוט ארבּע‑בשורה ובוט דמקה עודכנו להתנהגות חכמה ומאתגרת יותר.",
      tag: "AI",
    },
    {
      date: "05.02.2026",
      title: "משחק slither נאמן יותר למקור",
      desc: "התאמות חוקים והתנהגות משחק כדי לשחזר את החוויה המקורית.",
      tag: "Gameplay",
    },
    {
      date: "04.02.2026",
      title: "הוספת משחק איקס עיגול משודרג!",
      desc: "משחק איקס עיגול קלאסי עם לוח גדול יותר, אפשרות לשחק נגד בוט חכם, ומצב של גדלי לוח שונים (3x3, 5x5, 7x7) .",
      tag: "Games",
    },
    {
      date: "03.02.2026",
      title: "Wordel – ניחוש מילים",
      desc: "נוסף משחק ניחוש מילים בסגנון WORDEL עם טבלת תוצאות.",
      tag: "Games",
    },
    {
      date: "02.02.2026",
      title: "מערכת משתמשים חכמה",
      desc: "תצוגת משתמשים עם מדליות ותמונות פרופיל",
      tag: "Users",
    },
  ];

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      // fetch username from Firestore
      const snap = await getDoc(doc(db, "users", fbUser.uid));
      if (snap.exists()) {
        setUser({
          uid: fbUser.uid,
          username: snap.data().username,
          isAdmin: isAdminUid(fbUser.uid),
        });
      } else {
        setUser({ uid: fbUser.uid, username: "Player", isAdmin: isAdminUid(fbUser.uid) });
      }

      setLoading(false);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!feedbackOpen) return;

    const feedbackQuery = query(
      collection(db, "feedback"),
      orderBy("createdAt", "desc"),
      limit(30)
    );

    const unsub = onSnapshot(
      feedbackQuery,
      (snap) => {
        const rows: FeedbackEntry[] = snap.docs.map((entry) => {
          const data = entry.data() as {
            uid?: string;
            username?: string;
            kind?: FeedbackKind;
            text?: string;
            createdAt?: { toMillis?: () => number };
          };

          const createdAtMs =
            data.createdAt && typeof data.createdAt.toMillis === "function"
              ? data.createdAt.toMillis()
              : 0;

          return {
            id: entry.id,
            uid: typeof data.uid === "string" ? data.uid : "",
            username: typeof data.username === "string" ? data.username : "Player",
            kind: data.kind === "idea" || data.kind === "other" ? data.kind : "bug",
            text: typeof data.text === "string" ? data.text : "",
            createdAtMs,
          };
        });

        setFeedbackEntries(rows);
      },
      (err) => {
        console.warn("feedback feed listener failed:", err);
      }
    );

    return () => unsub();
  }, [feedbackOpen]);

  const submitFeedback = async () => {
    if (!user) {
      setFeedbackError("צריך להתחבר כדי לשלוח דיווח.");
      return;
    }

    const message = feedbackText.trim();
    if (message.length < 4) {
      setFeedbackError("נא לכתוב לפחות 4 תווים.");
      return;
    }

    setFeedbackSending(true);
    setFeedbackError("");
    try {
      await addDoc(collection(db, "feedback"), {
        uid: user.uid,
        username: user.username,
        kind: feedbackKind,
        text: message,
        createdAt: serverTimestamp(),
      });
      setFeedbackText("");
    } catch (err) {
      console.warn("feedback submit failed:", err);
      setFeedbackError("שליחה נכשלה. בדוק הרשאות Firebase/חיבור ונסה שוב.");
    } finally {
      setFeedbackSending(false);
    }
  };

  // UX: לנעול גלילה כשהמודאל פתוח
  useEffect(() => {
    if (!letterOpen && !updatesOpen && !feedbackOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [letterOpen, updatesOpen, feedbackOpen]);
  // UX: ESC closes modals
  useEffect(() => {
    if (!letterOpen && !updatesOpen && !feedbackOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLetterOpen(false);
        setUpdatesOpen(false);
        setFeedbackOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [letterOpen, updatesOpen, feedbackOpen]);

  if (loading) {
    return (
      <header style={styles.headerWrap}>
        <div style={styles.headerInner}>
          <div style={styles.leftGroup}>
            <div style={styles.brandWrap}>
              <div style={styles.brandBadge}>Y</div>
              <h2 style={styles.brandText}>yaliby.com</h2>
            </div>
          </div>

          <div style={styles.rightGroup}>
            <div style={{ ...styles.skeletonPill, width: 120 }} />
            <div style={{ ...styles.skeletonPill, width: 88 }} />
          </div>
        </div>
      </header>
    );
  }

  return (
    <>
      <header style={styles.headerWrap}>
        <div style={styles.headerInner}>
          {/* LEFT */}
          <div style={styles.leftGroup}>
            <div
              style={styles.brandWrap}
              onClick={() => navigate("/")}
              title="Back to Home"
            >
              <div style={styles.brandBadge}>Y</div>
              <h2 style={styles.brandText}>yaliby.com</h2>
            </div>

            <button style={styles.btnSoft} onClick={() => navigate("/")}>
              <span style={{ fontSize: 14 }}>Home</span>
            </button>

            <button
              style={styles.btnUpdates}
              onClick={() => setUpdatesOpen(true)}
              title="עדכונים אחרונים"
            >
              <span style={{ fontSize: 14 }}>עדכונים</span>
            </button>

            <button
              style={styles.btnFeedback}
              onClick={() => setFeedbackOpen(true)}
              title="דיווח תקלות והצעות"
            >
              <span style={{ fontSize: 14 }}>פידבק</span>
            </button>

            <button
              style={styles.btnLetter}
              onClick={() => setLetterOpen(true)}
              title="אימות משתמשים שעתי"
            >
              <span style={{ fontSize: 14 }}>אימות שעתי</span>
            </button>
          </div>

          {/* RIGHT */}
          <div style={styles.rightGroup}>
            {!user && (
              <>
                <button style={styles.btnGhost} onClick={() => navigate("/login")}>
                  Login
                </button>
                <button
                  style={styles.btnPrimary}
                  onClick={() => navigate("/register")}
                >
                  Register
                </button>
              </>
            )}

            {user && (
              <>
                <div style={styles.userInfoWrap}>
                  <div style={{ minWidth: 220 }}>
                    <UserBox userId={user.uid} />
                  </div>
                  {user.isAdmin && <span style={styles.adminBadge}>ADMIN</span>}
                </div>

                <button
                  style={styles.btnDanger}
                  onClick={async () => {
                    await signOut(auth);
                    navigate("/");
                  }}
                >
                  Logout
                </button>
              </>
            )}
          </div>
        </div>

        {/* Hover / animation helpers */}
        <style>{css}</style>
      </header>

      {/* LETTER MODAL */}
      {letterOpen && (
        <div
          style={{ ...modalStyles.backdrop, direction: "rtl", textAlign: "right", fontSize: 20 }}
          onMouseDown={(e) => {
            // סגירה בלחיצה על הרקע
            if (e.target === e.currentTarget) setLetterOpen(false);
          }}
          aria-label="Intel letter backdrop"
        >
          <div style={modalStyles.shell} role="dialog" aria-modal="true">
            <div style={modalStyles.topBar}>
              <div style={modalStyles.topLeft}>
                <span style={modalStyles.classifiedPill}>CLASSIFIED</span>
                <span style={modalStyles.topHint}>DevOps IT • Secure Notice</span>
              </div>

              <button
                style={modalStyles.closeBtn}
                onClick={() => setLetterOpen(false)}
                title="Close"
              >
                ✕
              </button>
            </div>

            <div style={modalStyles.noticeBanner}>
              בעקבות המתקפה של גל שפירו נעשית בדיקה שעתית לאימות המשתמשים.
            </div>

            <div style={modalStyles.noticeDetails}>
              <div style={modalStyles.noticeDetailsTitle}>פרטי המודעה</div>
              <ul style={modalStyles.noticeDetailsList}>
                <li>אימות משתמש מתבצע אחת לשעה לכל משתמש פעיל.</li>
                <li>משתמש שלא מאמת בזמן עשוי להיות מנותק עד התחברות מחדש.</li>
                <li>בכל חריגה, האירוע נרשם ומועבר לבדיקה מיידית.</li>
              </ul>
            </div>

            <div style={modalStyles.paperWrap}>
              <div style={modalStyles.paper}>
                <div style={modalStyles.stampRow}>
                  <div style={modalStyles.stamp}>
                    <div style={modalStyles.stampInner}>SECURE</div>
                    <div style={modalStyles.stampSub}>DC / Ops</div>
                  </div>

                  <div style={modalStyles.headerMini}>
                    <div style={modalStyles.paperTitle}>הודעת אבטחה רשמית</div>
                    <div style={modalStyles.paperSub}>
                      בעקבות המתקפה של גל שפירו • בדיקה שעתית לאימות משתמשים
                    </div>
                  </div>
                </div>

                <div style={modalStyles.body}>
                  <p style={modalStyles.p}>
                    <b>שימו לב:</b> בעקבות המתקפה של{" "}
                    <span style={modalStyles.badName}>גל שפירו</span>{" "}
                    נעשית בדיקה שעתית לאימות המשתמשים בכל המערכת.
                  </p>

                  <div style={modalStyles.alertBox}>
                    <div style={modalStyles.alertIcon}>⚠️</div>
                    <div>
                      <div style={modalStyles.alertTitle}>
                        מה זה אומר בפועל?
                      </div>
                      <ul style={modalStyles.ul}>
                        <li>אחת לשעה תתבקשו לבצע אימות משתמש.</li>
                        <li>
                          <b>משתמש שלא יאמת את עצמו עשוי להיות מנותק מהסשן.</b>
                        </li>
                        <li>במקרה חסימה יש להתחבר מחדש ולאמת שוב.</li>
                      </ul>
                    </div>
                  </div>


<div style={modalStyles.qaBox}>
  <div style={modalStyles.qaIcon}>🧪</div>

  <div style={{ flex: 1 }}>
    <div style={modalStyles.qaTitle}>סטטוס תפעולי</div>

    <p style={modalStyles.qaText}>
      צוות <b>QA</b> ו-<b>DevOps</b> מריצים בדיקה שעתית לאימות המשתמשים בזמן אמת.
      <br />
      <b>כל אירוע חריג נרשם ומטופל מיידית.</b>
      ניתן להפעיל בדיקה ידנית עכשיו.
      <br />
    </p>

    <button
      style={modalStyles.openScriptBtn}
      onClick={() => {
        setLetterOpen(false);
        window.dispatchEvent(new Event(HOURLY_MAGIC_OPEN_EVENT));
      }}
      title="הפעל בדיקת אימות ידנית"
    >
      הפעל בדיקת אימות עכשיו
    </button>

  </div>
</div>




                  <div style={modalStyles.terminal}>
                    <div style={modalStyles.termLine}>
                      <span style={modalStyles.dim}>root@ops:~$</span>{" "}
                      <span style={modalStyles.cmd}>whoami</span>
                    </div>
                    <div style={modalStyles.termLine}>
                      <span style={modalStyles.ok}>devops-it</span>
                    </div>
                    <div style={modalStyles.termLine}>
                      <span style={modalStyles.dim}>root@ops:~$</span>{" "}
                      <span style={modalStyles.cmd}>status</span>
                    </div>
                    <div style={modalStyles.termLine}>
                      <span style={modalStyles.bad}>THREAT_LEVEL=ELEVATED</span>
                      <span style={modalStyles.cursor}>¦</span>
                    </div>
                  </div>

                  <div style={modalStyles.footerLine} />

                  <p style={modalStyles.bottomSecret}>
                    הבדיקה השעתית פעילה עד הודעה חדשה.
                  </p>
                </div>
              </div>
            </div>

            <div style={modalStyles.actionsRow}>
              <button
                style={modalStyles.actionPrimary}
                onClick={() => {
                  setLetterOpen(false);
                  navigate("/");
                }}
              >
                הבנתי
              </button>

              
            </div>
          </div>
        </div>
      )}

      {/* UPDATES MODAL */}
      {updatesOpen && (
        <div
          style={{ ...modalStyles.backdrop, direction: "rtl", textAlign: "right" }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setUpdatesOpen(false);
          }}
          aria-label="updates backdrop"
        >
          <div style={modalStyles.updatesShell} role="dialog" aria-modal="true">
            <div style={modalStyles.updatesHeader}>
              <div>
                <div style={modalStyles.updatesTitle}>עדכונים אחרונים</div>
                <div style={modalStyles.updatesSubtitle}>
                  מסודר, מפורט ומעודכן
                </div>
              </div>
              <button
                style={modalStyles.closeBtn}
                onClick={() => setUpdatesOpen(false)}
                title="סגור"
              >
                ✕
              </button>
            </div>

            <div style={modalStyles.updatesBody}>
              {updatesLog.map((item, idx) => (
                <div key={`${item.date}-${item.title}`} style={modalStyles.updateRow}>
                  <div style={modalStyles.updateRail}>
                    <span
                      style={{
                        ...modalStyles.updateDot,
                        ...(idx === 0 ? modalStyles.updateDotActive : null),
                      }}
                    />
                    <span
                      style={{
                        ...modalStyles.updateLine,
                        ...(idx === updatesLog.length - 1
                          ? modalStyles.updateLineEnd
                          : null),
                      }}
                    />
                  </div>

                  <div
                    style={{
                      ...modalStyles.updateCard,
                      ...(idx === 0 ? modalStyles.updateCardActive : null),
                    }}
                  >
                    <div style={modalStyles.updateMeta}>
                      <span style={modalStyles.updateDate}>{item.date}</span>
                      <span style={modalStyles.updateTag}>{item.tag}</span>
                      {idx === 0 && <span style={modalStyles.updateNew}>חדש</span>}
                    </div>
                    <div style={modalStyles.updateTitle}>{item.title}</div>
                    <div style={modalStyles.updateDesc}>{item.desc}</div>
                    {item.details && item.details.length > 0 && (
                      <ul style={modalStyles.updateList}>
                        {item.details.map((line) => (
                          <li key={`${item.title}-${line}`} style={modalStyles.updateListItem}>
                            {line}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>

          </div>
        </div>
      )}

      {/* FEEDBACK MODAL */}
      {feedbackOpen && (
        <div
          style={{ ...modalStyles.backdrop, direction: "rtl", textAlign: "right" }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setFeedbackOpen(false);
          }}
          aria-label="feedback backdrop"
        >
          <div style={modalStyles.feedbackShell} role="dialog" aria-modal="true">
            <div style={modalStyles.feedbackHeader}>
              <div>
                <div style={modalStyles.feedbackTitle}>צ'אט תקלות והצעות</div>
                <div style={modalStyles.feedbackSubtitle}>
                  דווחו על באגים, רעיונות ושיפורים - זה עוזר לנו לשפר מהר.
                </div>
              </div>
              <button
                style={modalStyles.closeBtn}
                onClick={() => setFeedbackOpen(false)}
                title="סגור"
              >
                ✕
              </button>
            </div>

            <div style={modalStyles.feedbackBody}>
              <div style={modalStyles.feedbackComposer}>
                <label style={modalStyles.feedbackLabel} htmlFor="feedback-kind">
                  סוג
                </label>
                <select
                  id="feedback-kind"
                  style={modalStyles.feedbackSelect}
                  value={feedbackKind}
                  onChange={(e) => setFeedbackKind(e.target.value as FeedbackKind)}
                >
                  <option value="bug">תקלה</option>
                  <option value="idea">הצעה לשיפור</option>
                  <option value="other">אחר</option>
                </select>

                <label style={modalStyles.feedbackLabel} htmlFor="feedback-text">
                  הודעה
                </label>
                <textarea
                  id="feedback-text"
                  style={modalStyles.feedbackTextarea}
                  placeholder="כתבו כאן מה לא עובד / מה כדאי להוסיף..."
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  maxLength={600}
                />

                <div style={modalStyles.feedbackActionRow}>
                  <span style={modalStyles.feedbackCounter}>{feedbackText.trim().length}/600</span>
                  <button
                    style={modalStyles.feedbackSendBtn}
                    onClick={submitFeedback}
                    disabled={feedbackSending || !user}
                  >
                    {feedbackSending ? "שולח..." : "שלח"}
                  </button>
                </div>
                {!user && (
                  <div style={modalStyles.feedbackNotice}>יש להתחבר כדי לשלוח הודעה.</div>
                )}
                {feedbackError && <div style={modalStyles.feedbackError}>{feedbackError}</div>}
              </div>

              <div style={modalStyles.feedbackFeed}>
                {feedbackEntries.length === 0 ? (
                  <div style={modalStyles.feedbackEmpty}>עדיין אין הודעות.</div>
                ) : (
                  feedbackEntries.map((entry) => (
                    <article key={entry.id} style={modalStyles.feedbackCard}>
                      <div style={modalStyles.feedbackMeta}>
                        <span style={modalStyles.feedbackUser}>{entry.username}</span>
                        <span style={modalStyles.feedbackKindTag}>
                          {entry.kind === "bug" ? "תקלה" : entry.kind === "idea" ? "הצעה" : "אחר"}
                        </span>
                        <span style={modalStyles.feedbackTime}>
                          {formatFeedbackTime(entry.createdAtMs)}
                        </span>
                      </div>
                      <p style={modalStyles.feedbackText}>{entry.text}</p>
                    </article>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  headerWrap: {
    position: "sticky",
    top: 0,
    zIndex: 999,
    padding: "14px 16px",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    background:
      "linear-gradient(180deg, rgba(10,12,18,0.82) 0%, rgba(10,12,18,0.55) 100%)",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },

  headerInner: {
    maxWidth: 1150,
    margin: "0 auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },

  leftGroup: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minWidth: 240,
  },

  rightGroup: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
    minWidth: 240,
  },

  userInfoWrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },

  adminBadge: {
    padding: "5px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255, 211, 74, 0.42)",
    background:
      "linear-gradient(135deg, rgba(255,211,74,0.22) 0%, rgba(255,138,77,0.16) 100%)",
    color: "#FFE28D",
    fontSize: 11,
    fontWeight: 900,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    boxShadow: "0 8px 22px rgba(255, 180, 72, 0.22)",
    userSelect: "none",
    whiteSpace: "nowrap",
  },

  brandWrap: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    cursor: "pointer",
    userSelect: "none",
  },

  brandBadge: {
    width: 34,
    height: 34,
    borderRadius: 12,
    display: "grid",
    placeItems: "center",
    fontWeight: 900,
    color: "#0b0f1c",
    background:
      "radial-gradient(circle at 30% 30%, #ffd34a 0%, #ff8a4a 55%, #ff3d77 100%)",
    boxShadow: "0 8px 24px rgba(255, 92, 92, 0.18)",
  },

  brandText: {
    margin: 0,
    fontSize: 18,
    letterSpacing: 0.2,
    color: "rgba(255,255,255,0.95)",
    textShadow: "0 10px 20px rgba(0,0,0,0.35)",
  },

  btnGhost: {
    padding: "9px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.02)",
    color: "rgba(255,255,255,0.92)",
    cursor: "pointer",
    fontWeight: 700,
    transition: "transform .15s ease, background .15s ease, border .15s ease",
  },

  btnSoft: {
    padding: "9px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.92)",
    cursor: "pointer",
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    gap: 8,
    transition: "transform .15s ease, background .15s ease, border .15s ease",
  },

  btnPrimary: {
    padding: "9px 14px",
    borderRadius: 14,
    border: "none",
    color: "#0b0f1c",
    fontWeight: 900,
    cursor: "pointer",
    background:
      "linear-gradient(135deg, #ffd34a 0%, #ff9f4a 55%, #ff4ad8 130%)",
    boxShadow:
      "0 14px 30px rgba(255, 209, 92, 0.18), 0 10px 20px rgba(0,0,0,0.25)",
    transition: "transform .15s ease, filter .15s ease",
  },

  btnDanger: {
    padding: "9px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255, 90, 120, 0.25)",
    background: "rgba(255, 60, 120, 0.08)",
    color: "rgba(255,255,255,0.95)",
    cursor: "pointer",
    fontWeight: 900,
    transition: "transform .15s ease, background .15s ease, border .15s ease",
  },

  userChip: {
    display: "none",
  },

  skeletonPill: {
    height: 34,
    borderRadius: 14,
    background:
      "linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.10) 50%, rgba(255,255,255,0.04) 100%)",
    backgroundSize: "200% 100%",
    animation: "shine 1.2s ease-in-out infinite",
    border: "1px solid rgba(255,255,255,0.08)",
  },

  btnFeedback: {
    padding: "9px 12px",
    borderRadius: 12,
    border: "1px solid rgba(89,248,208,0.32)",
    background:
      "linear-gradient(135deg, rgba(89,248,208,0.14) 0%, rgba(124,92,255,0.10) 55%, rgba(255,209,92,0.08) 130%)",
    color: "rgba(255,255,255,0.95)",
    cursor: "pointer",
    fontWeight: 900,
    display: "flex",
    alignItems: "center",
    gap: 8,
    boxShadow: "0 12px 26px rgba(89,248,208,0.22)",
    transition: "transform .15s ease, filter .15s ease",
  },

  // Intel button
  btnLetter: {
    padding: "9px 12px",
    borderRadius: 12,
    border: "2px solid rgba(255, 50, 80, 1)",
    background:
      "linear-gradient(135deg, rgba(89,248,208,0.12) 0%, rgba(124,92,255,0.10) 55%, rgba(255,74,216,0.08) 130%)",
    color: "rgba(255,255,255,0.95)",
    cursor: "pointer",
    fontWeight: 900,
    display: "flex",
    alignItems: "center",
    gap: 8,
    boxShadow: "0 12px 26px rgba(255, 50, 80, 0.4)",
    transition: "transform .15s ease, filter .15s ease",
    animation: "blink-urgent 1.2s ease-in-out infinite",
  },

  btnUpdates: {
    padding: "9px 12px",
    borderRadius: 12,
    border: "1px solid rgba(124, 92, 255, 0.35)",
    background:
      "linear-gradient(135deg, rgba(124,92,255,0.16) 0%, rgba(89,248,208,0.10) 60%, rgba(255,209,92,0.08) 130%)",
    color: "rgba(255,255,255,0.95)",
    cursor: "pointer",
    fontWeight: 900,
    display: "flex",
    alignItems: "center",
    gap: 8,
    boxShadow: "0 12px 26px rgba(124, 92, 255, 0.25)",
    transition: "transform .15s ease, filter .15s ease",
  },
};

const modalStyles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 99999,
    background: "rgba(0,0,0,0.62)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    display: "grid",
    placeItems: "center",
    padding: 16,
  },

  shell: {
    width: "min(900px, 96vw)",
    borderRadius: 22,
    border: "1px solid rgba(255,255,255,0.12)",
    background:
      "linear-gradient(180deg, rgba(10,12,18,0.88) 0%, rgba(10,12,18,0.72) 100%)",
    boxShadow: "0 24px 90px rgba(0,0,0,0.60)",
    overflow: "hidden",
    position: "relative",
  },

  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
  },

  topLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },

  classifiedPill: {
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(255,80,120,0.12)",
    border: "1px solid rgba(255,80,120,0.25)",
    color: "rgba(255,255,255,0.95)",
    fontWeight: 900,
    letterSpacing: 1,
    fontSize: 12,
  },

  topHint: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: 700,
  },

  noticeBanner: {
    margin: "10px 14px 0 14px",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255, 116, 141, 0.35)",
    background:
      "linear-gradient(180deg, rgba(255, 80, 120, 0.16), rgba(124, 92, 255, 0.08))",
    color: "rgba(255,255,255,0.95)",
    fontSize: 13,
    fontWeight: 900,
    lineHeight: 1.45,
  },

  noticeDetails: {
    margin: "10px 14px 0 14px",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.03)",
  },

  noticeDetailsTitle: {
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: 0.2,
    marginBottom: 6,
    color: "rgba(255,255,255,0.92)",
  },

  noticeDetailsList: {
    margin: 0,
    paddingInlineStart: 18,
    color: "rgba(255,255,255,0.82)",
    fontSize: 12.5,
    lineHeight: 1.5,
  },

  closeBtn: {
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.04)",
    color: "rgba(255,255,255,0.92)",
    padding: "8px 12px",
    borderRadius: 14,
    cursor: "pointer",
    fontWeight: 900,
  },

  paperWrap: {
    padding: 14,
  },

  paper: {
    borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.10)",
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.03) 100%)",
    boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
    overflow: "hidden",
    position: "relative",
  },

  stampRow: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    padding: "14px 14px 10px 14px",
    borderBottom: "1px dashed rgba(255,255,255,0.12)",
  },

  stamp: {
    width: 96,
    height: 72,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.12)",
    background:
      "radial-gradient(circle at 30% 30%, rgba(255,181,71,0.28), rgba(255,79,216,0.14))",
    display: "grid",
    placeItems: "center",
    boxShadow: "0 18px 45px rgba(0,0,0,0.25)",
  },

  stampInner: {
    fontWeight: 1000,
    letterSpacing: 1.2,
  },

  stampSub: {
    opacity: 0.75,
    fontSize: 12,
    marginTop: -6,
  },

  headerMini: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },

  paperTitle: {
    fontSize: 18,
    fontWeight: 1000,
    letterSpacing: 0.3,
  },

  paperSub: {
    fontSize: 12,
    opacity: 0.7,
    fontWeight: 700,
  },

  body: {
    padding: 14,
  },

  p: {
    margin: 0,
    color: "rgba(255,255,255,0.88)",
    fontSize: 14,
    lineHeight: 1.5,
  },

  badName: {
    color: "rgba(255,80,120,0.98)",
    fontWeight: 1000,
    textShadow: "0 10px 25px rgba(255,80,120,0.15)",
  },

  alertBox: {
    marginTop: 12,
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    padding: 12,
    borderRadius: 18,
    border: "1px solid rgba(255,181,71,0.18)",
    background:
      "linear-gradient(180deg, rgba(255,181,71,0.10), rgba(255,79,216,0.06))",
  },

  alertIcon: {
    fontSize: 22,
    marginTop: 2,
  },

  alertTitle: {
    fontWeight: 1000,
    marginBottom: 6,
  },

  ul: {
    margin: 0,
    paddingInlineStart: 18,
    color: "rgba(255,255,255,0.84)",
    fontSize: 13.5,
    lineHeight: 1.5,
  },

  terminal: {
    marginTop: 12,
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.35)",
    padding: 12,
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
    fontSize: 12.5,
    boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
  },

  termLine: {
    color: "rgba(234,242,255,0.86)",
    lineHeight: 1.6,
  },

  dim: {
    opacity: 0.72,
  },

  cmd: {
    color: "rgba(89,248,208,0.95)",
    fontWeight: 900,
  },

  ok: {
    color: "rgba(56,242,138,0.95)",
    fontWeight: 900,
  },

  bad: {
    color: "rgba(255,80,120,0.95)",
    fontWeight: 900,
  },

  cursor: {
    display: "inline-block",
    marginLeft: 8,
    color: "rgba(89,248,208,0.85)",
  },

  footerLine: {
    marginTop: 14,
    height: 1,
    background: "rgba(255,255,255,0.10)",
  },

   bottomSecret: {
    fontSize: 27,
    marginTop: 12,
    marginBottom: 2,
    textAlign: "center",
    fontWeight: 1000,
    letterSpacing: 0.2,
    color: "rgba(240, 135, 22, 0.98)",
    textShadow: "0 0px 20px rgba(255, 50, 80, 0.6), 0 16px 35px rgba(0,0,0,0.45)",
    animation: "pulse-secret 1.5s ease-in-out infinite",
  },

  actionsRow: {
    display: "flex",
    gap: 10,
    justifyContent: "flex-end",
    alignItems: "center",
    padding: "12px 14px 14px 14px",
    borderTop: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.02)",
    flexWrap: "wrap",
  },

  actionPrimary: {
    border: "none",
    cursor: "pointer",
    padding: "10px 14px",
    borderRadius: 14,
    fontWeight: 1000,
    color: "#0b0f1c",
    background:
      "linear-gradient(135deg, rgba(89,248,208,0.95) 0%, rgba(124,92,255,0.85) 55%, rgba(255,79,216,0.75) 130%)",
    boxShadow: "0 14px 30px rgba(0,0,0,0.35)",
  },

  actionGhost: {
    cursor: "pointer",
    padding: "10px 14px",
    borderRadius: 14,
    fontWeight: 900,
    color: "rgba(255,255,255,0.92)",
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.04)",
  },

  updatesShell: {
    width: "min(720px, 96vw)",
    borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.12)",
    background:
      "linear-gradient(180deg, rgba(12,14,20,0.96) 0%, rgba(12,14,20,0.90) 100%)",
    boxShadow: "0 24px 90px rgba(0,0,0,0.60)",
    overflow: "hidden",
    position: "relative",
  },

  updatesHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 18px",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.02)",
  },

  updatesTitle: {
    fontSize: 18,
    fontWeight: 1000,
    color: "rgba(255,255,255,0.95)",
  },

  updatesSubtitle: {
    fontSize: 12,
    color: "rgba(255,255,255,0.58)",
    marginTop: 3,
    fontWeight: 700,
  },

  updatesBody: {
    padding: "16px 18px 18px 18px",
    display: "grid",
    gap: 12,
    maxHeight: "60vh",
    overflow: "auto",
  },

  updateRow: {
    display: "grid",
    gridTemplateColumns: "20px 1fr",
    gap: 12,
    alignItems: "stretch",
  },

  updateRail: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: 8,
  },

  updateCard: {
    borderRadius: 14,
    padding: "12px 14px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    boxShadow: "0 10px 28px rgba(0,0,0,0.32)",
    transition: "transform .2s ease, box-shadow .2s ease",
  },

  updateCardActive: {
    border: "1px solid rgba(89,248,208,0.25)",
    background:
      "linear-gradient(180deg, rgba(89,248,208,0.08), rgba(124,92,255,0.05))",
    boxShadow: "0 14px 36px rgba(0,0,0,0.36)",
  },

  updateMeta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 6,
  },

  updateDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: "rgba(255,255,255,0.35)",
    boxShadow: "0 0 0 3px rgba(255,255,255,0.06)",
  },

  updateDotActive: {
    background: "rgba(89,248,208,0.95)",
    boxShadow: "0 0 0 4px rgba(89,248,208,0.20)",
  },

  updateLine: {
    flex: 1,
    width: 2,
    marginTop: 6,
    background:
      "linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0))",
    borderRadius: 999,
  },

  updateLineEnd: {
    opacity: 0,
  },

  updateDate: {
    fontSize: 12,
    fontWeight: 800,
    color: "rgba(255,255,255,0.75)",
  },

  updateTag: {
    fontSize: 10.5,
    fontWeight: 900,
    padding: "3px 8px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "rgba(255,255,255,0.78)",
  },

  updateNew: {
    fontSize: 10.5,
    fontWeight: 1000,
    padding: "3px 8px",
    borderRadius: 999,
    background: "rgba(89,248,208,0.12)",
    border: "1px solid rgba(89,248,208,0.28)",
    color: "rgba(255,255,255,0.92)",
  },

  updateTitle: {
    fontSize: 15,
    fontWeight: 900,
    color: "rgba(255,255,255,0.95)",
    marginBottom: 4,
  },

  updateDesc: {
    fontSize: 13,
    color: "rgba(255,255,255,0.78)",
    lineHeight: 1.5,
  },

  updateList: {
    margin: "8px 0 0 0",
    paddingInlineStart: 18,
    display: "grid",
    gap: 4,
  },

  updateListItem: {
    color: "rgba(255,255,255,0.86)",
    fontSize: 12.5,
    lineHeight: 1.45,
  },

  feedbackShell: {
    width: "min(860px, 96vw)",
    borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.12)",
    background:
      "linear-gradient(180deg, rgba(12,14,20,0.96) 0%, rgba(12,14,20,0.90) 100%)",
    boxShadow: "0 24px 90px rgba(0,0,0,0.60)",
    overflow: "hidden",
    position: "relative",
  },

  feedbackHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "16px 18px",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.02)",
  },

  feedbackTitle: {
    fontSize: 18,
    fontWeight: 1000,
    color: "rgba(255,255,255,0.95)",
  },

  feedbackSubtitle: {
    fontSize: 12,
    color: "rgba(255,255,255,0.58)",
    marginTop: 3,
    fontWeight: 700,
  },

  feedbackBody: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 12,
    padding: 14,
    maxHeight: "68vh",
  },

  feedbackComposer: {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    padding: 12,
    display: "grid",
    gap: 8,
    alignContent: "start",
  },

  feedbackLabel: {
    fontSize: 12,
    fontWeight: 800,
    color: "rgba(255,255,255,0.86)",
  },

  feedbackSelect: {
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(0,0,0,0.28)",
    color: "rgba(255,255,255,0.94)",
    padding: "8px 10px",
    fontWeight: 700,
  },

  feedbackTextarea: {
    minHeight: 120,
    resize: "vertical",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(0,0,0,0.28)",
    color: "rgba(255,255,255,0.94)",
    padding: 10,
    fontFamily: "inherit",
    fontSize: 13.5,
    lineHeight: 1.45,
  },

  feedbackActionRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  feedbackCounter: {
    fontSize: 11.5,
    color: "rgba(255,255,255,0.56)",
    fontWeight: 700,
  },

  feedbackSendBtn: {
    border: "none",
    cursor: "pointer",
    padding: "9px 14px",
    borderRadius: 12,
    fontWeight: 900,
    color: "#0b0f1c",
    background:
      "linear-gradient(135deg, rgba(89,248,208,0.95) 0%, rgba(124,92,255,0.85) 55%, rgba(255,79,216,0.75) 130%)",
    boxShadow: "0 12px 26px rgba(0,0,0,0.32)",
  },

  feedbackNotice: {
    fontSize: 12,
    color: "rgba(255,220,141,0.94)",
    fontWeight: 700,
  },

  feedbackError: {
    fontSize: 12,
    color: "rgba(255,120,144,0.95)",
    fontWeight: 800,
  },

  feedbackFeed: {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.02)",
    padding: 10,
    overflow: "auto",
    display: "grid",
    gap: 8,
    alignContent: "start",
  },

  feedbackEmpty: {
    fontSize: 13,
    color: "rgba(255,255,255,0.58)",
    padding: "8px 4px",
    fontWeight: 700,
  },

  feedbackCard: {
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: "10px 11px",
    display: "grid",
    gap: 6,
  },

  feedbackMeta: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },

  feedbackUser: {
    fontSize: 12.5,
    fontWeight: 900,
    color: "rgba(255,255,255,0.92)",
  },

  feedbackKindTag: {
    fontSize: 10.5,
    fontWeight: 900,
    borderRadius: 999,
    padding: "2px 8px",
    border: "1px solid rgba(89,248,208,0.28)",
    background: "rgba(89,248,208,0.10)",
    color: "rgba(255,255,255,0.92)",
  },

  feedbackTime: {
    marginInlineStart: "auto",
    fontSize: 11,
    color: "rgba(255,255,255,0.56)",
    fontWeight: 700,
  },

  feedbackText: {
    margin: 0,
    fontSize: 13.5,
    color: "rgba(255,255,255,0.86)",
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },

  qaBox: {
  marginTop: 12,
  display: "flex",
  gap: 12,
  alignItems: "flex-start",
  padding: 12,
  borderRadius: 18,
  border: "1px solid rgba(124, 92, 255, 0.20)",
  background:
    "linear-gradient(180deg, rgba(124,92,255,0.12), rgba(255,79,216,0.06))",
},

qaIcon: {
  fontSize: 22,
  marginTop: 2,
},

qaTitle: {
  fontWeight: 1000,
  marginBottom: 6,
  color: "rgba(234,242,255,0.92)",
},

qaText: {
  margin: 0,
  color: "rgba(255,255,255,0.84)",
  fontSize: 13.5,
  lineHeight: 1.5,
},

openScriptBtn: {
  marginTop: 10,
  border: "1px solid rgba(255,80,120,0.25)",
  background:
    "linear-gradient(135deg, rgba(255,80,120,0.16) 0%, rgba(124,92,255,0.10) 55%, rgba(89,248,208,0.08) 130%)",
  color: "rgba(255,255,255,0.95)",
  padding: "10px 12px",
  borderRadius: 14,
  cursor: "pointer",
  fontWeight: 1000,
  boxShadow: "0 14px 30px rgba(0,0,0,0.35)",
},

qaNote: {
  marginTop: 8,
  fontSize: 12,
  opacity: 0.72,
  color: "rgba(234,242,255,0.78)",
},

};

const css = `
  @keyframes shine {
    0% { background-position: 0% 0%; }
    100% { background-position: -200% 0%; }
  }

  @keyframes blink-urgent {
    0%, 100% { 
      border-color: rgba(255, 50, 80, 1);
      box-shadow: 0 12px 26px rgba(255, 50, 80, 0.4);
    }
    50% { 
      border-color: rgba(255, 150, 150, 0.6);
      box-shadow: 0 12px 26px rgba(255, 50, 80, 0.15);
    }
  }

  @keyframes pulse-secret {
    0%, 100% {
      opacity: 1;
      text-shadow: 0 0px 20px rgba(255, 50, 80, 0.6), 0 16px 35px rgba(0,0,0,0.45);
    }
    50% {
      opacity: 0.7;
      text-shadow: 0 0px 35px rgba(255, 50, 80, 0.9), 0 20px 50px rgba(255, 50, 80, 0.3);
    }
  }

  header button:hover {
    transform: translateY(-1px);
  }

  header button:active {
    transform: translateY(0px) scale(0.99);
  }

  header button:hover {
    filter: brightness(1.05);
  }
`;
