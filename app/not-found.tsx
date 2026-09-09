import Link from "next/link";
export default function NotFound() {
  return (
    <main>
      <h1>Room not found</h1>
      <p>Check the room URL or head back to the lobby.</p>
      <Link href="/">Back to lobby →</Link>
    </main>
  );
}
