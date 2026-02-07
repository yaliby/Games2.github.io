import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useUserProfile } from "./useUserProfile";
import "./UserBox.css";

type UserBoxProps = {
  userId: string;
};

const FALLBACK_AVATAR =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCA4MCA4MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSI0MCIgY3k9IjQwIiByPSI0MCIgZmlsbD0iI0IyQzZGRiIvPjxjaXJjbGUgY3g9IjQwIiBjeT0iMzAiIHI9IjEyIiBmaWxsPSIjRjJGN0ZGIi8+PHBhdGggZD0iTTIwIDY0QzI1LjUgNTUuNSAzMi41IDUwIDQwIDUwQzQ3LjUgNTAgNTQuNSA1NS41IDYwIDY0IiBzdHJva2U9IiNGMkY3RkYiIHN0cm9rZS13aWR0aD0iNyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PC9zdmc+";

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

export default function UserBox({ userId }: UserBoxProps) {
  const navigate = useNavigate();
  const { profile, loading } = useUserProfile(userId);

  const medals = useMemo(() => profile?.medals ?? [], [profile]);

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

  return (
    <button
      type="button"
      className="userbox"
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
        <div className="userbox__medals">
          {medals.length === 0 ? (
            <div className="userbox__medal userbox__medal--empty">—</div>
          ) : (
            medals.map((m) => (
              <div key={m.id} className="userbox__medal" data-tooltip={`${m.title} — ${m.description}`}>
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
