import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
export const metadata: Metadata = {
  title: "Chaos — rooms",
  description: "Shared Markdown worlds. Humans and agents in the same room.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="masthead">
          <Link className="brand" href="/">
            CHAOS<span>_</span>
          </Link>
          <span className="muted">worlds / people / agents</span>
          <Link href="/">[ lobby ]</Link>
        </header>
        {children}
        <footer>CHAOS v1 · a world file + an event stream</footer>
      </body>
    </html>
  );
}
