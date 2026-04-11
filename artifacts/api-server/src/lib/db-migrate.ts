import { supabase } from "./supabase";
import { logger } from "./logger";

export const MIGRATION_SQL = `-- Execute no Supabase SQL Editor: https://supabase.com/dashboard/project/yikemdxcswfvmwdvykiw/sql

-- Tabela de usuários
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Configurações Evolution por usuário
CREATE TABLE IF NOT EXISTS public.evolution_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  url text NOT NULL DEFAULT '',
  api_key text NOT NULL DEFAULT '',
  instance_name text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Log de auditoria
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  logged_at timestamptz NOT NULL DEFAULT now(),
  admin_id text NOT NULL,
  admin_email text NOT NULL,
  action text NOT NULL,
  target_id text NOT NULL,
  target_email text,
  detail text NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_log_logged_at_idx ON public.audit_log(logged_at DESC);`;

// Supabase REST returns PGRST205 for missing tables (table not in schema cache)
// and 42P01 for actual SQL errors. We detect by error code.
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (error.message ?? "").includes("schema cache")
  );
}

export async function runMigrations(): Promise<void> {
  logger.info("Checking database tables...");

  const [usersCheck, evoCheck, auditCheck] = await Promise.all([
    supabase.from("users").select("id").limit(0),
    supabase.from("evolution_configs").select("id").limit(0),
    supabase.from("audit_log").select("id").limit(0),
  ]);

  const missing: string[] = [];
  if (isMissingTable(usersCheck.error)) missing.push("users");
  if (isMissingTable(evoCheck.error)) missing.push("evolution_configs");
  if (isMissingTable(auditCheck.error)) missing.push("audit_log");

  if (missing.length === 0) {
    logger.info("All database tables present.");
    return;
  }

  logger.error(
    { missing },
    `\n\n❌ TABELAS FALTANDO NO BANCO DE DADOS: ${missing.join(", ")}\n\n` +
    `Execute o SQL abaixo no Supabase SQL Editor e reinicie o servidor:\n` +
    `https://supabase.com/dashboard/project/yikemdxcswfvmwdvykiw/sql/new\n\n` +
    MIGRATION_SQL + "\n"
  );

  throw new Error(
    `Required database tables missing: [${missing.join(", ")}]. ` +
    `Run the migration SQL printed in the logs in your Supabase SQL Editor, then restart the server.`
  );
}
