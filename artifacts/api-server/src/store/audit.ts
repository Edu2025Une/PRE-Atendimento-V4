import { supabase } from "../lib/supabase";
import { logger } from "../lib/logger";

export type AuditAction =
  | "user.create"
  | "user.update"
  | "user.delete"
  | "user.role.change"
  | "user.status.change"
  | "evolution-config.admin.view"
  | "evolution-config.admin.update"
  | "evolution-config.admin.delete";

export interface AuditEntry {
  id: string;
  timestamp: string;
  adminId: string;
  adminEmail: string;
  action: AuditAction;
  targetId: string;
  targetEmail?: string;
  detail: string;
}

export async function logAction(
  adminId: string,
  adminEmail: string,
  action: AuditAction,
  targetId: string,
  detail: string,
  targetEmail?: string,
): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    admin_id: adminId,
    admin_email: adminEmail,
    action,
    target_id: targetId,
    target_email: targetEmail ?? null,
    detail,
  });
  if (error) logger.error({ error }, "Failed to write audit log");
}

export async function getAuditLog(limit = 100): Promise<{ entries: AuditEntry[]; total: number }> {
  const [countResult, dataResult] = await Promise.all([
    supabase.from("audit_log").select("*", { count: "exact", head: true }),
    supabase
      .from("audit_log")
      .select("*")
      .order("logged_at", { ascending: false })
      .limit(Math.min(limit, 500)),
  ]);

  if (dataResult.error) {
    logger.error({ error: dataResult.error }, "getAuditLog error");
    return { entries: [], total: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entries: AuditEntry[] = (dataResult.data ?? []).map((r: any) => ({
    id: r.id as string,
    timestamp: r.logged_at as string,
    adminId: r.admin_id as string,
    adminEmail: r.admin_email as string,
    action: r.action as AuditAction,
    targetId: r.target_id as string,
    targetEmail: r.target_email as string | undefined,
    detail: r.detail as string,
  }));

  return { entries, total: countResult.count ?? 0 };
}
