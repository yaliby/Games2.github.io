const envAdminUids = import.meta.env.VITE_ADMIN_UIDS;
const envAdminUid = import.meta.env.VITE_ADMIN_UID;

const rawAdminUids = String(envAdminUids ?? envAdminUid ?? "");

const ADMIN_UIDS = new Set(
  rawAdminUids
    .split(",")
    .map((uid) => uid.trim())
    .filter(Boolean)
);

export function isAdminUid(uid: string | null | undefined): boolean {
  if (!uid) return false;
  return ADMIN_UIDS.has(uid);
}

export function getAdminDebugInfo(uid: string | null | undefined) {
  const host = typeof window !== "undefined" ? window.location.host : "unknown";
  const path = typeof window !== "undefined" ? window.location.pathname : "unknown";

  return {
    host,
    path,
    uid: uid ?? null,
    hasMatch: uid ? ADMIN_UIDS.has(uid) : false,
    envSource: envAdminUids ? "VITE_ADMIN_UIDS" : envAdminUid ? "VITE_ADMIN_UID" : "none",
    rawEnvLength: rawAdminUids.length,
    parsedAdminCount: ADMIN_UIDS.size,
    parsedAdminUids: [...ADMIN_UIDS],
  };
}
