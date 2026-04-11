import bcrypt from "bcryptjs";
import { supabase } from "../lib/supabase";
import { logger } from "../lib/logger";

export type Role = "admin" | "user";

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToStored(row: any): StoredUser {
  return {
    id: row.id as string,
    name: row.name as string,
    email: row.email as string,
    passwordHash: row.password_hash as string,
    role: row.role as Role,
    active: row.active as boolean,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function toPublic(u: StoredUser): PublicUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    active: u.active,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export async function seedAdmin(): Promise<void> {
  const { data: existing } = await supabase
    .from("users")
    .select("id")
    .eq("email", "admin@example.com")
    .maybeSingle();

  if (existing) {
    logger.info("Admin user already exists.");
    return;
  }

  const passwordHash = await bcrypt.hash("password123", 10);
  const { error } = await supabase.from("users").insert({
    name: "Administrador",
    email: "admin@example.com",
    password_hash: passwordHash,
    role: "admin",
    active: true,
  });

  if (error) throw new Error("Failed to seed admin user: " + error.message);
  logger.info("Admin user seeded.");
}

export async function findByEmail(email: string): Promise<StoredUser | undefined> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .maybeSingle();
  if (error) { logger.error({ error }, "findByEmail error"); return undefined; }
  if (!data) return undefined;
  return rowToStored(data);
}

export async function findById(id: string): Promise<StoredUser | undefined> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) { logger.error({ error }, "findById error"); return undefined; }
  if (!data) return undefined;
  return rowToStored(data);
}

export async function createUser(
  name: string,
  email: string,
  password: string,
  role: Role = "user",
): Promise<PublicUser> {
  const passwordHash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from("users")
    .insert({ name, email, password_hash: passwordHash, role, active: true })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toPublic(rowToStored(data));
}

export async function updateUser(
  id: string,
  fields: Partial<Pick<StoredUser, "name" | "role" | "active">>,
): Promise<PublicUser | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbFields: Record<string, any> = { updated_at: new Date().toISOString() };
  if (fields.name !== undefined) dbFields["name"] = fields.name;
  if (fields.role !== undefined) dbFields["role"] = fields.role;
  if (fields.active !== undefined) dbFields["active"] = fields.active;

  const { data, error } = await supabase
    .from("users")
    .update(dbFields)
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) { logger.error({ error }, "updateUser error"); return null; }
  if (!data) return null;
  return toPublic(rowToStored(data));
}

export async function deleteUser(id: string): Promise<boolean> {
  const { error } = await supabase.from("users").delete().eq("id", id);
  if (error) { logger.error({ error }, "deleteUser error"); return false; }
  return true;
}

export async function listUsers(): Promise<PublicUser[]> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) { logger.error({ error }, "listUsers error"); return []; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => toPublic(rowToStored(r)));
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
