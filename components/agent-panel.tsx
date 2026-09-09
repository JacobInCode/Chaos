"use client";
import { useEffect, useState, type FormEvent } from "react";
import { db, mcpEndpoint } from "@/lib/supabase";
import { ensureHuman } from "@/lib/api";
import { errorMessage } from "@/lib/model";
import { CopyButton } from "./shared";
type Token = {
  id: string;
  agent_user_id: string | null;
  created_at: string;
  revoked_at: string | null;
};
export function AgentPanel({
  roomId,
  humanName,
}: {
  roomId: string;
  humanName: string;
}) {
  const [token, setToken] = useState("");
  const [tokens, setTokens] = useState<Token[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    const { data: auth } = await db().auth.getSession();
    if (!auth.session) {
      setTokens([]);
      return;
    }
    const { data, error } = await db()
      .from("mcp_tokens")
      .select("id,agent_user_id,created_at,revoked_at")
      .eq("owner_user_id", auth.session.user.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false });
    if (error) throw error;
    setTokens(data);
  }
  useEffect(() => {
    void refresh().catch((error) => setError(errorMessage(error)));
  }, []);
  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setToken("");
    const name = String(new FormData(event.currentTarget).get("agent"));
    try {
      await ensureHuman(humanName);
      const { data, error } = await db().rpc("create_mcp_token", {
        agent_name: name,
      });
      if (error) throw error;
      if (!data?.[0]?.token)
        throw new Error("The token function returned no token.");
      setToken(data[0].token);
      await refresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel agent-panel">
      <h2>Connect an external agent</h2>
      <p>
        Use Streamable HTTP with a bearer token. Give your agent this room ID.
      </p>
      <p className="hint">
        This token can access public rooms and any known room ID through the
        hosted MCP. It is not restricted to this room. Keep it private.
      </p>
      {error && (
        <p className="error notice" role="alert">
          {error}
        </p>
      )}
      <label>
        MCP endpoint
        <input readOnly value={mcpEndpoint} />
      </label>
      <CopyButton value={mcpEndpoint} />
      <label>
        Room ID
        <input readOnly value={roomId} />
      </label>
      <CopyButton value={roomId} />
      <form onSubmit={generate} className="agent-form">
        <label>
          Agent name
          <input name="agent" required maxLength={80} placeholder="Agent" />
        </label>
        <button disabled={busy}>
          {busy ? "Working…" : "Generate bearer token"}
        </button>
      </form>
      {token && (
        <div className="token-result">
          <p>
            Copy this token now. It is shown only here and disappears when you
            close this panel.
          </p>
          <label>
            Bearer token
            <input
              readOnly
              value={token}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <CopyButton value={token} label="Copy token" />
          <details>
            <summary>Connection configuration</summary>
            <pre>
              {JSON.stringify(
                {
                  mcpServers: {
                    chaos: {
                      url: mcpEndpoint,
                      headers: { Authorization: `Bearer ${token}` },
                    },
                  },
                },
                null,
                2,
              )}
            </pre>
          </details>
        </div>
      )}
      {tokens.length > 0 && (
        <details>
          <summary>Your active tokens ({tokens.length})</summary>
          <ul className="token-list">
            {tokens.map((item) => (
              <li key={item.id}>
                <span>
                  Agent {item.agent_user_id?.slice(0, 8)} ·{" "}
                  {new Date(item.created_at).toLocaleDateString()}
                </span>
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      const { data, error } = await db()
                        .from("mcp_tokens")
                        .update({ revoked_at: new Date().toISOString() })
                        .eq("id", item.id)
                        .select("id");
                      if (error) throw error;
                      if (!data?.length)
                        throw new Error("This token could not be revoked.");
                      setToken("");
                      await refresh();
                    } catch (error) {
                      setError(errorMessage(error));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
