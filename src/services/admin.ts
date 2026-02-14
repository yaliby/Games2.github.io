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
