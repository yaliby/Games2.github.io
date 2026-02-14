const rawAdminUids = String(import.meta.env.VITE_ADMIN_UIDS ?? "");

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

