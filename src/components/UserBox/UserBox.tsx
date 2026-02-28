import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useUserProfile } from "./useUserProfile";
import { updateMedalTooltipPlacement } from "./medalTooltipPlacement";
import "./UserBox.css";

type UserBoxProps = {
  userId: string;
  medalMode?: "fit" | "wrap";
};

type MedalFit = {
  size: number;
  gap: number;
};

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function optimizePhotoUrl(input: string): string {
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return input;

    const host = url.hostname;
    const params = url.searchParams;

    if (host.endsWith("images.unsplash.com")) {
      params.set("w", "256");
      params.set("h", "256");
      params.set("fit", "crop");
      params.set("auto", "format");
      url.search = params.toString();
      return url.toString();
    }

    if (host === "avatars.githubusercontent.com") {
      params.set("s", "256");
      url.search = params.toString();
      return url.toString();
    }

    if (host.endsWith("googleusercontent.com")) {
      url.pathname = url.pathname.replace(/=s\\d+-c$/, "");
      return `${url.toString()}=s256-c`;
    }

    if (host === "cdn.discordapp.com") {
      params.set("size", "256");
      url.search = params.toString();
      return url.toString();
    }

    return url.toString();
  } catch {
    return input;
  }
}

export default function UserBox({ userId, medalMode = "fit" }: UserBoxProps) {
  const navigate = useNavigate();
  const { profile, loading } = useUserProfile(userId);
  const medalsRef = useRef<HTMLDivElement | null>(null);
  const [medalFit, setMedalFit] = useState<MedalFit | null>(null);

  const medals = useMemo(() => profile?.medals ?? [], [profile]);
  const medalsCount = medals.length;

  useEffect(() => {
    if (medalMode !== "fit") {
      setMedalFit(null);
      return;
    }

    const el = medalsRef.current;
    if (!el || medalsCount <= 1) {
      setMedalFit(null);
      return;
    }

    const updateFit = () => {
      const width = el.clientWidth;
      if (!Number.isFinite(width) || width <= 0) return;

      const minSize = 9;
      const maxSize = 30;
      const minGap = 1;
      const maxGap = 10;
      const requiredGaps = Math.max(0, medalsCount - 1);

      let size = Math.floor((width - minGap * requiredGaps) / medalsCount);
      size = clamp(size, minSize, maxSize);

      let gap = requiredGaps > 0
        ? Math.floor((width - size * medalsCount) / requiredGaps)
        : maxGap;
      gap = clamp(gap, minGap, maxGap);

      setMedalFit((prev) => (prev && prev.size === size && prev.gap === gap ? prev : { size, gap }));
    };

    updateFit();
    const ro = new ResizeObserver(updateFit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [medalsCount, medalMode]);

  if (loading) {
    return (
      <div className="userbox userbox--loading">
        <div className="userbox__avatar skeleton" />
        <div className="userbox__info">
          <div className="userbox__name skeleton" />
          <div className="userbox__medals">
            <div className="userbox__medal skeleton" />
            <div className="userbox__medal skeleton" />
            <div className="userbox__medal skeleton" />
          </div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="userbox userbox--empty">
        <div className="userbox__avatar userbox__avatar--fallback">P</div>
        <div className="userbox__info">
          <div className="userbox__name">Player</div>
        </div>
      </div>
    );
  }

  const optimizedPhoto = profile.photoURL ? optimizePhotoUrl(profile.photoURL) : "";
  const medalsStyle = medalFit
    ? ({
        "--ub-medal-fit-size": `${medalFit.size}px`,
        "--ub-medal-fit-gap": `${medalFit.gap}px`,
      } as CSSProperties)
    : undefined;

  return (
    <button
      type="button"
      className={`userbox ${medalMode === "wrap" ? "userbox--medals-wrap" : ""}`}
      onClick={() => navigate(`/profile/${userId}`)}
      aria-label={`Open profile for ${profile.username}`}
    >
      {profile.photoURL ? (
        <img
          className="userbox__avatar"
          src={optimizedPhoto}
          alt={profile.username}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="userbox__avatar userbox__avatar--fallback">
          {profile.username?.trim()?.charAt(0).toUpperCase() || "P"}
        </div>
      )}
      <div className="userbox__info">
        <div className="userbox__name">{profile.username}</div>
        <div className="userbox__medals" ref={medalsRef} style={medalsStyle}>
          {medals.length === 0 ? (
            <div className="userbox__medal userbox__medal--empty">—</div>
          ) : (
            medals.map((m) => (
              <div
                key={m.id}
                className="userbox__medal"
                data-tooltip={`${m.title} — ${m.description}`}
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
          )}
        </div>
      </div>
    </button>
  );
}
