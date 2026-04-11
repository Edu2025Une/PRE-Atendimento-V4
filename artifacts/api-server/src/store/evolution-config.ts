import { supabase } from "../lib/supabase";
import { logger } from "../lib/logger";

export interface PublicEvolutionConfig {
  url: string;
  instanceName: string;
  hasApiKey: boolean;
  updatedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPublic(row: any): PublicEvolutionConfig {
  return {
    url: row.url as string,
    instanceName: row.instance_name as string,
    hasApiKey: typeof row.api_key === "string" && row.api_key.length > 0,
    updatedAt: row.updated_at as string,
  };
}

export async function getConfig(userId: string): Promise<{ url: string; apiKey: string; instanceName: string } | undefined> {
  const { data, error } = await supabase
    .from("evolution_configs")
    .select("url, api_key, instance_name")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) { logger.error({ error }, "getConfig error"); return undefined; }
  if (!data) return undefined;
  return {
    url: data.url as string,
    apiKey: data.api_key as string,
    instanceName: data.instance_name as string,
  };
}

export async function getPublicConfig(userId: string): Promise<PublicEvolutionConfig | null> {
  const { data, error } = await supabase
    .from("evolution_configs")
    .select("url, api_key, instance_name, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) { logger.error({ error }, "getPublicConfig error"); return null; }
  if (!data) return null;
  return rowToPublic(data);
}

export async function saveConfig(
  userId: string,
  url: string,
  apiKey: string,
  instanceName: string,
): Promise<PublicEvolutionConfig> {
  const cleanUrl = url.replace(/\/$/, "");

  const existing = await getConfig(userId);
  const finalApiKey = apiKey || existing?.apiKey || "";

  const payload = {
    user_id: userId,
    url: cleanUrl,
    api_key: finalApiKey,
    instance_name: instanceName,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("evolution_configs")
    .upsert(payload, { onConflict: "user_id" })
    .select("url, api_key, instance_name, updated_at")
    .single();

  if (error) throw new Error("Failed to save evolution config: " + error.message);
  return rowToPublic(data);
}

export async function deleteConfig(userId: string): Promise<void> {
  const { error } = await supabase
    .from("evolution_configs")
    .delete()
    .eq("user_id", userId);
  if (error) { logger.error({ error }, "deleteConfig error"); throw new Error("Failed to delete config: " + error.message); }
}

export async function listAllConfigs(): Promise<Array<{ userId: string } & PublicEvolutionConfig>> {
  const { data, error } = await supabase
    .from("evolution_configs")
    .select("user_id, url, api_key, instance_name, updated_at");
  if (error) { logger.error({ error }, "listAllConfigs error"); return []; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({ userId: r.user_id as string, ...rowToPublic(r) }));
}
