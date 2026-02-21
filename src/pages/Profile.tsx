import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "../services/firebase";
import UserBox from "../components/UserBox/UserBox";
import { useUserProfile } from "../components/UserBox/useUserProfile";
import { updateMedalTooltipPlacement } from "../components/UserBox/medalTooltipPlacement";

type ProfileData = {
  username: string;
  photoURL?: string;
  bestScore?: number;
  achievements?: Array<{ id: string; earnedAt?: any }>;
};

function isValidUsername(name: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_]{2,17}$/.test(name);
}

export default function Profile() {
  const { uid } = useParams<{ uid: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  const [editPhotoURL, setEditPhotoURL] = useState("");

  const isOwner = useMemo(() => currentUid && uid && currentUid === uid, [currentUid, uid]);
  const { profile: medalProfile } = useUserProfile(uid ?? null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUid(user?.uid ?? null);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!uid) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const snap = await getDoc(doc(db, "users", uid));
        if (!snap.exists()) {
          if (!cancelled) {
            setProfile(null);
            setLoading(false);
          }
          return;
        }

        const data = snap.data() as any;
        const loaded: ProfileData = {
          username: String(data?.username ?? "Player"),
          photoURL: data?.photoURL ? String(data.photoURL) : "",
          bestScore: typeof data?.bestScore === "number" ? data.bestScore : 0,
          achievements: Array.isArray(data?.achievements) ? data.achievements : [],
        };

        if (!cancelled) {
          setProfile(loaded);
          setEditUsername(loaded.username);
          setEditPhotoURL(loaded.photoURL ?? "");
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message ?? "Failed to load profile");
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  async function saveProfile() {
    if (!uid) return;
    setError(null);
    setSaved(false);

    const nextUsername = editUsername.trim();
    const nextPhotoURL = editPhotoURL.trim();

    if (!isValidUsername(nextUsername)) {
      setError("Username must be 3-18 characters and start with a letter/number.");
      return;
    }

    try {
      setSaving(true);
      await updateDoc(doc(db, "users", uid), {
        username: nextUsername,
        photoURL: nextPhotoURL || "",
      });
      setProfile((prev) =>
        prev
          ? { ...prev, username: nextUsername, photoURL: nextPhotoURL || "" }
          : prev
      );
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err?.message ?? "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  if (!uid) {
    return (
      <div style={{ padding: 24, color: "#EAF0FF" }}>
        Missing user id.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 24, color: "#EAF0FF" }}>
        Loading profile...
      </div>
    );
  }

  if (!profile) {
    return (
      <div style={{ padding: 24, color: "#EAF0FF" }}>
        User not found.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px", color: "#EAF0FF" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <UserBox userId={uid} />
        <button
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.92)",
            cursor: "pointer",
            fontWeight: 700,
          }}
          onClick={() => navigate(-1)}
        >
          Back
        </button>
      </div>

      <div
        style={{
          marginTop: 18,
          padding: 16,
          borderRadius: 16,
          border: "1px solid rgba(120,150,255,.14)",
          background: "rgba(8,10,18,.55)",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Profile</div>
        <div style={{ opacity: 0.85, fontSize: 13 }}>
          Best score: {profile.bestScore ?? 0}
        </div>
      </div>
      <div
        style={{
          marginTop: 18,
          padding: 16,
          borderRadius: 16,
          border: "1px solid rgba(120,150,255,.14)",
          background: "rgba(8,10,18,.55)",
        }}
      >
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Medals</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {medalProfile?.allMedals?.length ? (
            medalProfile.allMedals.map((m) => (
              <div
                key={m.id}
                className="userbox__medal"
                onMouseEnter={(event) => updateMedalTooltipPlacement(event.currentTarget)}
              >
                {m.icon ? (
                  <img src={m.icon} alt={m.title} />
                ) : (
                  <span>{m.title.slice(0, 1).toUpperCase()}</span>
                )}
                <div className="userbox__tooltip">
                  <div className="userbox__tooltip-title">{m.title}</div>
                  <div className="userbox__tooltip-desc">{m.description}</div>
                </div>
              </div>
            ))
          ) : (
            <div style={{ opacity: 0.7, fontSize: 12 }}>No medals yet.</div>
          )}
        </div>
      </div>
      {isOwner && (
        <div
          style={{
            marginTop: 18,
            padding: 16,
            borderRadius: 16,
            border: "1px solid rgba(120,150,255,.14)",
            background: "rgba(8,10,18,.55)",
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ fontWeight: 900 }}>Edit your profile</div>

          <label style={{ display: "grid", gap: 6, fontSize: 12, opacity: 0.9 }}>
            Username
            <input
              value={editUsername}
              onChange={(e) => setEditUsername(e.target.value)}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(0,0,0,0.25)",
                color: "rgba(255,255,255,0.92)",
                outline: "none",
              }}
            />
          </label>

          <label style={{ display: "grid", gap: 6, fontSize: 12, opacity: 0.9 }}>
            Photo URL
            <input
              value={editPhotoURL}
              onChange={(e) => setEditPhotoURL(e.target.value)}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(0,0,0,0.25)",
                color: "rgba(255,255,255,0.92)",
                outline: "none",
              }}
            />
          </label>

          {error && (
            <div
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255, 107, 189, 0.35)",
                background: "rgba(255, 107, 189, 0.10)",
                padding: 12,
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}

          {saved && (
            <div
              style={{
                borderRadius: 12,
                border: "1px solid rgba(89, 248, 208, 0.35)",
                background: "rgba(89, 248, 208, 0.10)",
                padding: 12,
                fontSize: 12,
                color: "rgba(230, 255, 246, 0.95)",
              }}
            >
              Saved successfully.
            </div>
          )}

          <button
            onClick={saveProfile}
            disabled={saving}
            style={{
              height: 40,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "linear-gradient(135deg, rgba(93,128,255,0.95), rgba(255,107,189,0.85))",
              color: "white",
              fontWeight: 800,
              cursor: "pointer",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

