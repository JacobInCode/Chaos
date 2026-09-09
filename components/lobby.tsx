"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { configured, db } from "@/lib/supabase";
import { ensureHuman } from "@/lib/api";
import { errorMessage, type Room } from "@/lib/model";
import { SetupNotice } from "./shared";
export function Lobby() {
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [markdown, setMarkdown] = useState("# A new world\n\nIt begins here.");
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!configured) return;
    let active = true;
    setLoading(true);
    db()
      .from("rooms")
      .select("*")
      .eq("visibility", "public")
      .not("current_world_version_id", "is", null)
      .order("created_at", { ascending: false })
      .order("id")
      .range(page * 50, page * 50 + 49)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(error.message);
        else {
          setRooms(data);
          setMore(data.length === 50);
        }
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await ensureHuman(String(form.get("human")));
      const { data, error } = await db().rpc("v1_create_room", {
        p_name: String(form.get("name")).trim(),
        p_visibility: String(form.get("visibility")),
        p_markdown: markdown,
      });
      if (error) throw error;
      router.push(`/r/${data}`);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <SetupNotice />
      <div className="page-title">
        <h1>The lobby</h1>
        <span className="tag">OPEN ROOMS</span>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <div className="lobby-grid">
        <section className="panel">
          <h2>
            <span className="dot" />
            Public rooms
          </h2>
          {loading ? (
            <p className="empty" role="status">
              Tuning in…
            </p>
          ) : rooms.length === 0 ? (
            <div className="empty">
              <p>No rooms on this page.</p>
              <p className="muted">Start a world. Leave the door open.</p>
            </div>
          ) : (
            <ul className="room-list">
              {rooms.map((room) => (
                <li key={room.id}>
                  <Link href={`/r/${room.id}`}>
                    <strong># {room.name}</strong>
                    <span className="muted">
                      {room.forked_from_room_id
                        ? "forked world"
                        : "original world"}{" "}
                      <span aria-hidden="true">↗</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="pagination">
            <button
              disabled={!page || loading}
              onClick={() => setPage(page - 1)}
            >
              ← Previous
            </button>
            <button
              disabled={!more || loading}
              onClick={() => setPage(page + 1)}
            >
              Next →
            </button>
          </div>
        </section>
        <section className="panel">
          <h2>Start a room</h2>
          <form onSubmit={create}>
            <label>
              Your name
              <input name="human" maxLength={80} placeholder="Anonymous" />
            </label>
            <label>
              Room name
              <input
                name="name"
                required
                maxLength={120}
                placeholder="The last outpost"
              />
            </label>
            <label>
              Visibility
              <select name="visibility" defaultValue="unlisted">
                <option value="unlisted">Unlisted — share the URL</option>
                <option value="public">Public — appear in the lobby</option>
              </select>
            </label>
            <p className="hint">
              Unlisted rooms are accessible to anyone with the URL; they are not
              private.
            </p>
            <label>
              Initial world · Markdown
              <textarea
                name="world"
                required
                maxLength={200000}
                rows={9}
                value={markdown}
                onChange={(event) => setMarkdown(event.target.value)}
              />
            </label>
            <label className="file-label">
              Or load a .md file
              <input
                type="file"
                accept=".md,.markdown,text/markdown,text/plain"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (file.size > 200000) {
                    setError("Choose a Markdown file under 200 KB.");
                    return;
                  }
                  try {
                    setMarkdown(await file.text());
                  } catch {
                    setError("The file could not be read.");
                  }
                }}
              />
            </label>
            <button className="primary" disabled={busy || !configured}>
              {busy ? "Opening room…" : "Create room →"}
            </button>
            <p className="hint">
              No account needed. Your anonymous identity stays in this browser.
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}
