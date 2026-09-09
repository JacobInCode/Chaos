"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { configured, db } from "@/lib/supabase";
import { catchUpEvents, ensureHuman, getRoom, recentEvents } from "@/lib/api";
import {
  errorMessage,
  eventText,
  mergeEvents,
  type Room,
  type RoomEvent,
  type World,
} from "@/lib/model";
import { CopyButton, SetupNotice } from "./shared";
import { AgentPanel } from "./agent-panel";

export function RoomView({ roomId }: { roomId: string }) {
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [status, setStatus] = useState("Connecting…");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [fork, setFork] = useState<RoomEvent | null>(null);
  const [agents, setAgents] = useState(false);
  const [source, setSource] = useState(false);
  const [url, setUrl] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const forkDialog = useRef<HTMLDialogElement>(null);
  const stickToBottom = useRef(true);
  const merge = useCallback((incoming: RoomEvent[]) => {
    setEvents((current) => mergeEvents(current, incoming));
  }, []);

  useEffect(() => {
    setUrl(window.location.href);
    if (!configured) {
      setLoading(false);
      return;
    }
    let active = true;
    let syncing = false;
    let syncAgain = false;
    const refreshRoom = async () => {
      const result = await getRoom(roomId);
      if (active) {
        setRoom(result.room);
        setWorld(result.world);
      }
    };
    // Subscribe first; merge the initial page with inserts received during the fetch.
    // Catch-up re-reads an inclusive overlap, so an insert callback cannot skip a missed event.
    let checkpoint = 0;
    async function sync() {
      if (syncing) {
        syncAgain = true;
        return;
      }
      syncing = true;
      try {
        do {
          syncAgain = false;
          const next = await catchUpEvents(roomId, checkpoint);
          if (!active) return;
          merge(next);
          if (next.length) checkpoint = next[next.length - 1].id;
          await refreshRoom();
        } while (syncAgain && active);
      } catch (error) {
        if (active) setError(errorMessage(error));
      } finally {
        syncing = false;
      }
    }
    let initialDone = false;
    const channel = db()
      .channel(`room:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "events",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (!active) return;
          merge([payload.new as RoomEvent]);
          if (initialDone) void sync();
        },
      )
      .subscribe((state) => {
        if (!active) return;
        setStatus(
          state === "SUBSCRIBED"
            ? "Live"
            : state === "CHANNEL_ERROR" || state === "TIMED_OUT"
              ? "Reconnecting…"
              : "Connecting…",
        );
        if (state === "SUBSCRIBED" && initialDone) void sync();
      });
    void (async () => {
      try {
        const [, initial] = await Promise.all([
          refreshRoom(),
          recentEvents(roomId),
        ]);
        if (!active) return;
        merge(initial);
        setMore(initial.length === 100);
        checkpoint = initial.length ? initial[initial.length - 1].id : 0;
        initialDone = true;
        // Always reconcile, including when SUBSCRIBED preceded the initial response.
        await sync();
        const { data } = await db().auth.getSession();
        if (data.session) {
          const profile = await db()
            .from("users")
            .select("name")
            .eq("id", data.session.user.id)
            .maybeSingle();
          if (active) setName(profile.data?.name ?? "");
        }
      } catch (error) {
        if (active) setError(errorMessage(error));
      } finally {
        if (active) setLoading(false);
      }
    })();
    const resume = () => {
      if (document.visibilityState === "visible" && initialDone) void sync();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      void db().removeChannel(channel);
    };
  }, [roomId, merge]);
  useEffect(() => {
    if (stickToBottom.current)
      end.current?.scrollIntoView({ block: "nearest" });
  }, [events]);
  useEffect(() => {
    if (fork && !forkDialog.current?.open) forkDialog.current?.showModal();
  }, [fork]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    setError("");
    try {
      const userId = await ensureHuman(name);
      const { data, error } = await db()
        .from("events")
        .insert({
          room_id: roomId,
          user_id: userId,
          type: "message",
          payload: {
            content: message.trim(),
            name: name.trim() || "Anonymous",
          },
        })
        .select("*")
        .single();
      if (error) throw error;
      stickToBottom.current = true;
      merge([data]);
      setMessage("");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      busy ||
      !message.trim()
    )
      return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  async function createFork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fork) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await ensureHuman(name);
      const { data, error } = await db().rpc("v1_fork_room", {
        p_source_room_id: roomId,
        p_event_id: fork.id,
        p_name: String(form.get("name")).trim(),
        p_visibility: String(form.get("visibility")),
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
    <main className="room-page">
      <SetupNotice />
      {error && (
        <div role="alert" className="notice error">
          {error}
          <button onClick={() => setError("")} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}
      {loading ? (
        <p role="status">Opening room…</p>
      ) : !room ? (
        <p>
          Room unavailable. <Link href="/">Back to lobby</Link>
        </p>
      ) : (
        <>
          <div className="page-title">
            <div>
              <h1># {room.name}</h1>
              <p className="muted">
                {room.visibility}
                {room.forked_from_room_id && (
                  <>
                    {" "}
                    · forked from{" "}
                    <Link href={`/r/${room.forked_from_room_id}`}>
                      another room
                    </Link>{" "}
                    at event #{room.forked_at_event_id}
                  </>
                )}
              </p>
            </div>
            <div className="actions">
              <CopyButton value={url} label="Copy room URL" />
              <button aria-expanded={agents} onClick={() => setAgents(!agents)}>
                Connect an agent
              </button>
            </div>
          </div>
          {agents && <AgentPanel roomId={roomId} humanName={name} />}
          <div className="world-chat">
            <section className="panel world-panel">
              <div className="panel-title">
                <h2>world.md</h2>
                <button onClick={() => setSource(!source)}>
                  {source ? "Read" : "Source"}
                </button>
              </div>
              {world ? (
                <>
                  <div className="markdown">
                    {source ? (
                      <pre>{world.markdown}</pre>
                    ) : (
                      <ReactMarkdown>{world.markdown}</ReactMarkdown>
                    )}
                  </div>
                  <details className="version">
                    <summary>Snapshot details</summary>
                    <p>
                      Version <code>{world.id}</code>
                    </p>
                    <p>Saved {new Date(world.created_at).toLocaleString()}</p>
                    <p>
                      This snapshot is immutable. Fork the room to take its
                      history in a new direction.
                    </p>
                  </details>
                </>
              ) : (
                <p className="empty">This room has no world snapshot.</p>
              )}
            </section>
            <section className="panel chat-panel">
              <div className="panel-title">
                <h2>Event stream</h2>
                <span className="live">
                  <span className={status === "Live" ? "dot" : "dot offline"} />
                  {status}
                </span>
              </div>
              <div
                className="stream"
                role="log"
                aria-label="Room events"
                aria-live="polite"
                aria-relevant="additions"
                onScroll={(event) => {
                  const el = event.currentTarget;
                  stickToBottom.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                }}
              >
                {more && (
                  <button
                    className="older"
                    disabled={olderBusy}
                    onClick={async () => {
                      setOlderBusy(true);
                      stickToBottom.current = false;
                      try {
                        const page = await recentEvents(roomId, events[0]?.id);
                        merge(page);
                        setMore(page.length === 100);
                      } catch (error) {
                        setError(errorMessage(error));
                      } finally {
                        setOlderBusy(false);
                      }
                    }}
                  >
                    {olderBusy ? "Loading…" : "↑ Older events"}
                  </button>
                )}
                {!events.length && (
                  <div className="empty">
                    <p>The room is quiet.</p>
                    <p className="muted">Say something. See what happens.</p>
                  </div>
                )}
                {events.map((event) => (
                  <article
                    className={`event ${event.type === "message" ? "" : "system-event"}`}
                    key={event.id}
                  >
                    <div className="event-meta">
                      <strong>
                        {eventText(event, "name") ||
                          (event.user_id
                            ? `user:${event.user_id.slice(0, 6)}`
                            : "system")}
                      </strong>
                      <time dateTime={event.created_at}>
                        {new Date(event.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      <span>#{event.id}</span>
                      <button
                        aria-label={`Fork at event ${event.id}`}
                        onClick={() => setFork(event)}
                      >
                        fork ↗
                      </button>
                    </div>
                    <p>
                      {event.type === "message"
                        ? eventText(event, "content")
                        : event.type.replaceAll("_", " ")}
                    </p>
                  </article>
                ))}
                <div ref={end} />
              </div>
              <form className="composer" onSubmit={send}>
                <label className="identity">
                  Your name
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={80}
                    placeholder="Anonymous"
                  />
                </label>
                <label className="message-label">
                  Message
                  <textarea
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    onKeyDown={sendOnEnter}
                    required
                    maxLength={20000}
                    rows={3}
                    placeholder="Write to the room…"
                  />
                </label>
                <div className="composer-bottom">
                  <span className="hint">
                    Enter to send · Shift+Enter for a new line.
                  </span>
                  <button
                    className="primary"
                    disabled={busy || !message.trim()}
                  >
                    {busy ? "Sending…" : "Send →"}
                  </button>
                </div>
              </form>
            </section>
          </div>
          {fork && (
            <dialog
              ref={forkDialog}
              className="modal panel"
              aria-labelledby="fork-title"
              onCancel={(event) => {
                if (busy) event.preventDefault();
                else setFork(null);
              }}
            >
              <h2 id="fork-title">Fork at event #{fork.id}</h2>
              <p>
                Create an independent room with the world and history up to this
                event, inclusive.
              </p>
              {error && (
                <p className="notice error" role="alert">
                  {error}
                </p>
              )}
              <form onSubmit={createFork}>
                <label>
                  New room name
                  <input
                    autoFocus
                    required
                    name="name"
                    maxLength={120}
                    defaultValue={`${room.name.slice(0, 113)} (fork)`}
                  />
                </label>
                <label>
                  Visibility
                  <select name="visibility" defaultValue={room.visibility}>
                    <option value="unlisted">Unlisted</option>
                    <option value="public">Public</option>
                  </select>
                </label>
                <p className="hint">The original room stays as it is.</p>
                <div className="actions">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setFork(null)}
                  >
                    Cancel
                  </button>
                  <button className="primary" disabled={busy}>
                    {busy ? "Forking…" : "Create fork →"}
                  </button>
                </div>
              </form>
            </dialog>
          )}
        </>
      )}
    </main>
  );
}
