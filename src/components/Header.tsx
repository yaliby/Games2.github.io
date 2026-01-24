import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "../services/firebase";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../services/firebase";

type UserInfo = {
  uid: string;
  username: string;
} | null;

export default function Header() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserInfo>(null);
  const [loading, setLoading] = useState(true);

  // 📩 Letter modal
  const [letterOpen, setLetterOpen] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      // שליפת username מ-Firestore
      const snap = await getDoc(doc(db, "users", fbUser.uid));
      if (snap.exists()) {
        setUser({
          uid: fbUser.uid,
          username: snap.data().username,
        });
      } else {
        setUser({ uid: fbUser.uid, username: "Player" });
      }

      setLoading(false);
    });

    return () => unsub();
  }, []);

  const userInitial = useMemo(() => {
    if (!user?.username) return "P";
    return user.username.trim().charAt(0).toUpperCase();
  }, [user?.username]);

  // UX: לנעול גלילה כשהמכתב פתוח
  useEffect(() => {
    if (!letterOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [letterOpen]);

  // UX: ESC סוגר מכתב
  useEffect(() => {
    if (!letterOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLetterOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [letterOpen]);

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
              <span style={{ fontSize: 16 }}>🏠</span>
              <span>Home</span>
            </button>
          </div>

          {/* RIGHT */}
          <div style={styles.rightGroup}>
            {/* 📩 Envelope button (תמיד מוצג) */}
            <button
              style={styles.btnLetter}
              onClick={() => setLetterOpen(true)}
              title="Secure Intel Letter"
            >
              <span style={{ fontSize: 16 }}>📩</span>
              <span>Intel</span>
            </button>

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
                <div style={styles.userChip}>
                  <div style={styles.avatar}>{userInitial}</div>
                  <div style={styles.userTextWrap}>
                    <div style={styles.userHello}>Welcome</div>
                    <div style={styles.userName}>{user.username}</div>
                  </div>
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

      {/* 📩 LETTER MODAL */}
      {letterOpen && (
        <div
          style={{ ...modalStyles.backdrop, direction: "rtl", textAlign: "right", fontSize: 20 }}
          onMouseDown={(e) => {
            // קליק בחוץ סוגר
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

            <div style={modalStyles.paperWrap}>
              <div style={modalStyles.paper}>
                <div style={modalStyles.stampRow}>
                  <div style={modalStyles.stamp}>
                    <div style={modalStyles.stampInner}>SECURE</div>
                    <div style={modalStyles.stampSub}>DC / Ops</div>
                  </div>

                  <div style={modalStyles.headerMini}>
                    <div style={modalStyles.paperTitle}>📨 מכתב התרעה</div>
                    <div style={modalStyles.paperSub}>
                      עדכון מודיעיני • רמת סיווג: גבוהה
                    </div>
                  </div>
                </div>

                <div style={modalStyles.body}>
                  <p style={modalStyles.p}>
                    <b>שימו לב:</b> לא מזמן התקבל מידע מודיעיני שהתוקף הידוע{" "}
                    <span style={modalStyles.badName}>גל שפירו</span>{" "}
                    מבצע ניסיונות פריצה לאתר.
                  </p>

                  <div style={modalStyles.alertBox}>
                    <div style={modalStyles.alertIcon}>⚠️</div>
                    <div>
                      <div style={modalStyles.alertTitle}>
                        הנחיות אבטחה למשתמשים
                      </div>
                      <ul style={modalStyles.ul}>
                        <li>יש להיזהר ולגלוש באחריות.</li>
                        <li>
                          <b>להימנע מללחוץ על מקשים שלא אמורים ללחוץ עליהם.</b>
                        </li>
                        <li>אם משהו נראה מוזר — צא מהדף וחזור מחדש.</li>
                      </ul>
                    </div>
                  </div>


<div style={modalStyles.qaBox}>
  <div style={modalStyles.qaIcon}>🧪</div>

  <div style={{ flex: 1 }}>
    <div style={modalStyles.qaTitle}>עדכון מצוות QA</div>

    <p style={modalStyles.qaText}>
      צוות ה־<b>QA</b> הצליח להוציא סקריפט חשוד שניסה להיכנס למערכת.
      <br />
      <b>לא ברור מה הסקריפט עושה.</b>  
      הוא נראה כאילו הוא מנסה לבצע פעולה “אוטומטית” ברקע.
      <br />
    </p>

    <button
      style={modalStyles.openScriptBtn}
      onClick={() => {
        setLetterOpen(false);

        // 🎭 Surprise URL: זה "אבסורדי" בכוונה, כדי ליפול ל-404 שלך
        const absurdUrl =
          "/ops/qa/dropbox_dump/extracted_payload/" +
          "unknown_gl_shapiro_vector/" +
          "do-not-open/" +
          "⚠️/⚠️/⚠️/" +
          "tux_vs_windows/" +
          "this_should_not_exist/" +
          Date.now();

        navigate(absurdUrl);
      }}
      title="Open extracted script (unknown behavior)"
    >
      🧨 פתח סקריפט חשוד 
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
                      <span style={modalStyles.cursor}>▌</span>
                    </div>
                  </div>

                  <div style={modalStyles.footerLine} />

                  <p style={modalStyles.bottomSecret}>
                    אל תסתכל ב-"צמנהב" אלה במה שיש מתחתיו
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
                הבנתי • חזרה לבית
              </button>

              
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
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "6px 10px",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    boxShadow: "0 18px 35px rgba(0,0,0,0.25)",
  },

  avatar: {
    width: 34,
    height: 34,
    borderRadius: 14,
    display: "grid",
    placeItems: "center",
    fontWeight: 900,
    color: "rgba(255,255,255,0.95)",
    background:
      "linear-gradient(135deg, rgba(91, 125, 255, 0.9) 0%, rgba(255, 74, 216, 0.75) 100%)",
    boxShadow: "0 12px 28px rgba(120, 140, 255, 0.20)",
  },

  userTextWrap: {
    display: "flex",
    flexDirection: "column",
    lineHeight: 1.05,
  },

  userHello: {
    fontSize: 11,
    opacity: 0.7,
    fontWeight: 700,
  },

  userName: {
    fontSize: 14,
    fontWeight: 900,
    letterSpacing: 0.2,
    opacity: 0.95,
    maxWidth: 150,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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

    // 📩 envelope button
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
