import { createClient } from "@supabase/supabase-js";

const url = process.env["SUPABASE_URL"];
const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

if (!url) throw new Error("SUPABASE_URL environment variable is required");
if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY environment variable is required");

export const supabase = createClient(url, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
