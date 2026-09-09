import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// Additive RPCs supplied in backend/v1.sql; generated types above reflect live inspection.
type V1Database = Database & {
  public: {
    Functions: {
      v1_create_room: {
        Args: { p_name: string; p_visibility: string; p_markdown: string };
        Returns: string;
      };
      v1_fork_room: {
        Args: {
          p_source_room_id: string;
          p_event_id: number;
          p_name: string;
          p_visibility: string;
        };
        Returns: string;
      };
    };
  };
};
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const mcpEndpoint = `${supabaseUrl}/functions/v1/mcp`;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
export const configured = Boolean(supabaseUrl && key);
let client: ReturnType<typeof createClient<V1Database>> | undefined;
export function db() {
  if (!configured)
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to connect Chaos.",
    );
  return (client ??= createClient<V1Database>(supabaseUrl, key));
}
