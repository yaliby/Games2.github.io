import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "../services/firebase";
import UserBox from "../components/UserBox/UserBox";
import { useUserProfile } from "../components/UserBox/useUserProfile";
import { updateMedalTooltipPlacement } from "../components/UserBox/medalTooltipPlacement";
import { compressImageFileToDataUrl } from "../services/imagePaste";

type ProfileData = {
  username: string;
  photoURL?: string;
  bestScore?: number;
  achievements?: Array<{ id: string; earnedAt?: any }>;
};

function isValidUsername(name: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_]{2,17}$/.test(name);
}

function clampNumber(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

export default function Profile() {
  const { uid } = useParams<{ uid: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [currentUid, setCurrentUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  const [editPhotoURL, setEditPhotoURL] = useState("");
  const medalsGridRef = useRef<HTMLDivElement | null>(null);
  const [medalGridFit, setMedalGridFit] = useState({ size: 26, gap: 8 });

  const isOwner = useMemo(() => currentUid && uid && currentUid === uid, [currentUid, uid]);
  const { profile: medalProfile } = useUserProfile(uid ?? null);
  const medalCount = medalProfile?.allMedals?.length ?? 0;
  const medalGridStyle = useMemo(() => ({
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: `${medalGridFit.gap}px`,
    "--ub-medal-size": `${medalGridFit.size}px`,
    "--ub-medal-radius": `${Math.max(6, Math.round(medalGridFit.size * 0.32))}px`,
    "--ub-medal-gap": `${medalGridFit.gap}px`,
  } as CSSProperties), [medalGridFit.gap, medalGridFit.size]);

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

  useEffect(() => {
    const el = medalsGridRef.current;
    if (!el || medalCount <= 0) {
      setMedalGridFit({ size: 26, gap: 8 });
      return;
    }

    const updateFit = () => {
      const width = el.clientWidth;
      if (!Number.isFinite(width) || width <= 0) return;

      const gap = clampNumber(Math.floor(width / 86), 5, 11);
      const targetSize = clampNumber(Math.floor(width / 7.8), 22, 34);
      const preferredCols = clampNumber(
        Math.floor((width + gap) / (targetSize + gap)),
        1,
        Math.max(1, medalCount),
      );
      const nextSize = clampNumber(
        Math.floor((width - gap * Math.max(0, preferredCols - 1)) / preferredCols),
        18,
        36,
      );

      setMedalGridFit((prev) => (
        prev.size === nextSize && prev.gap === gap ? prev : { size: nextSize, gap }
      ));
    };

    updateFit();
    const observer = new ResizeObserver(updateFit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [medalCount]);

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

  async function onPhotoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    setSaved(false);
    setPhotoProcessing(true);
    try {
      const imageDataUrl = await compressImageFileToDataUrl(file);
      setEditPhotoURL(imageDataUrl);
    } catch (err: any) {
      setError(err?.message ? String(err.message) : "Failed to process image file");
    } finally {
      setPhotoProcessing(false);
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
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div
          style={{
            flex: "1 1 320px",
            minWidth: 0,
            maxWidth: "100%",
            "--ub-scale": 1.08,
            "--ub-medal-base": 30,
          } as CSSProperties}
        >
          <UserBox userId={uid} medalMode="wrap" />
        </div>
        <button
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.92)",
            cursor: "pointer",
            fontWeight: 700,
            flex: "0 0 auto",
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
        <div ref={medalsGridRef} style={medalGridStyle}>
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
            Upload profile photo
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
              onChange={onPhotoFileChange}
              style={{
                padding: "8px 10px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(0,0,0,0.25)",
                color: "rgba(255,255,255,0.92)",
                outline: "none",
              }}
            />
          </label>

          {photoProcessing && (
            <div style={{ fontSize: 12, color: "rgba(173, 214, 255, 0.95)", fontWeight: 700 }}>
              Processing image...
            </div>
          )}

          {editPhotoURL && (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: 12, opacity: 0.9 }}>Photo preview</div>
              <img
                src={editPhotoURL}
                alt="Profile preview"
                style={{
                  width: 132,
                  height: 132,
                  borderRadius: 16,
                  objectFit: "cover",
                  border: "1px solid rgba(255,255,255,0.16)",
                  boxShadow: "0 10px 24px rgba(0,0,0,0.35)",
                }}
              />
              <button
                type="button"
                onClick={() => setEditPhotoURL("")}
                style={{
                  width: "fit-content",
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: "1px solid rgba(255, 127, 164, 0.35)",
                  background: "rgba(255, 127, 164, 0.12)",
                  color: "rgba(255, 216, 232, 0.95)",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                Remove photo
              </button>
            </div>
          )}

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
            disabled={saving || photoProcessing}
            style={{
              height: 40,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "linear-gradient(135deg, rgba(93,128,255,0.95), rgba(255,107,189,0.85))",
              color: "white",
              fontWeight: 800,
              cursor: "pointer",
              opacity: saving || photoProcessing ? 0.7 : 1,
            }}
          >
            {saving ? "Saving..." : photoProcessing ? "Processing image..." : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

