import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { register } from "../services/authService";

export default function Register() {
  const navigate = useNavigate();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const passwordHint = useMemo(() => {
    if (!password) return "Use at least 6 characters";
    if (password.length < 6) return "Too short (min 6)";
    return "Looks good";
  }, [password]);

  const canSubmit = useMemo(() => {
    return username.trim().length > 0 && password.length >= 6 && !loading;
  }, [username, password, loading]);

  async function handleRegister(e?: React.FormEvent) {
    e?.preventDefault();

    const u = username.trim();
    if (!u || !password) {
      setError("Please fill all fields");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      await register(u, password);

      navigate("/");
    } catch (err: any) {
      setError(err?.message || "Register failed");
    } finally {
      setLoading(false);
    }
  }

  const S = styles;

  return (
    <div style={S.page}>
      <div style={S.bgGlow} />
      <div style={S.card}>
        <div style={S.header}>
          <div style={S.title}>Create account</div>
          <div style={S.subtitle}>Pick a username and a password</div>
        </div>

        <form onSubmit={handleRegister} style={S.form}>
          <label style={S.label}>
            Username
            <input
              style={S.input}
              placeholder="your_username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              spellCheck={false}
            />
          </label>

          <label style={S.label}>
            Password
            <div style={S.passRow}>
              <input
                style={{ ...S.input, paddingRight: 84 }}
                type={showPass ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="button"
                style={S.passBtn}
                onClick={() => setShowPass(s => !s)}
                aria-label={showPass ? "Hide password" : "Show password"}
              >
                {showPass ? "Hide" : "Show"}
              </button>
            </div>
            <div style={{ ...S.hint, opacity: password ? 1 : 0.8 }}>{passwordHint}</div>
          </label>

          {error && (
            <div style={S.errorBox}>
              <div style={S.errorTitle}>Couldn’t register</div>
              <div style={S.errorText}>{error}</div>
            </div>
          )}

          <button type="submit" style={{ ...S.primaryBtn, opacity: canSubmit ? 1 : 0.6 }} disabled={!canSubmit}>
            {loading ? "Creating..." : "Register"}
          </button>

          <div style={S.footerRow}>
            <span style={S.muted}>Already have an account?</span>
            <Link style={S.link} to="/login">
              Login
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: 16,
    position: "relative",
    overflow: "hidden",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial",
  },
  bgGlow: {
    position: "absolute",
    inset: -200,
    filter: "blur(10px)",
    pointerEvents: "none",
  },
  card: {
    width: "min(420px, 100%)",
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 18,
    boxShadow: "0 18px 70px rgba(0,0,0,0.45)",
    backdropFilter: "blur(10px)",
    padding: 18,
    color: "rgba(255,255,255,0.92)",
    position: "relative",
  },
  header: {
    padding: "10px 8px 14px 8px",
  },
  title: { fontSize: 24, fontWeight: 800, letterSpacing: -0.3 },
  subtitle: { marginTop: 6, fontSize: 13, color: "rgba(255,255,255,0.68)" },
  form: { display: "grid", gap: 12, padding: 8 },
  label: { display: "grid", gap: 6, fontSize: 12, color: "rgba(255,255,255,0.78)" },
  input: {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.25)",
    color: "rgba(255,255,255,0.92)",
    outline: "none",
  },
  passRow: { position: "relative" },
  passBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    height: 32,
    padding: "0 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.07)",
    color: "rgba(255,255,255,0.85)",
    cursor: "pointer",
  },
  hint: {
    marginTop: 6,
    fontSize: 12,
    color: "rgba(255,255,255,0.62)",
  },
  primaryBtn: {
    marginTop: 4,
    height: 44,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "linear-gradient(135deg, rgba(93,128,255,0.95), rgba(255,107,189,0.85))",
    color: "white",
    fontWeight: 800,
    cursor: "pointer",
  },
  errorBox: {
    borderRadius: 12,
    border: "1px solid rgba(255, 107, 189, 0.35)",
    background: "rgba(255, 107, 189, 0.10)",
    padding: 12,
  },
  errorTitle: { fontSize: 12, fontWeight: 800 },
  errorText: { marginTop: 4, fontSize: 12, color: "rgba(255,255,255,0.85)" },
  footerRow: {
    display: "flex",
    justifyContent: "center",
    gap: 8,
    marginTop: 4,
    fontSize: 13,
  },
  muted: { color: "rgba(255,255,255,0.70)" },
  link: { color: "rgba(160, 200, 255, 0.95)", textDecoration: "none", fontWeight: 700 },
};
