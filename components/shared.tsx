"use client";
import { useState } from "react";
import { configured } from "@/lib/supabase";
export function SetupNotice() {
  return configured ? null : (
    <div className="notice" role="status">
      Connect your Supabase project using the two values in{" "}
      <code>.env.example</code>, then restart the app.
    </div>
  );
}
export function CopyButton({
  value,
  label = "Copy",
}: {
  value: string;
  label?: string;
}) {
  const [status, setStatus] = useState("");
  return (
    <span className="copy-control">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setStatus("Copied");
          } catch {
            setStatus("Select and copy the text manually.");
          }
        }}
      >
        {label}
      </button>
      <span role="status" className="muted">
        {status}
      </span>
    </span>
  );
}
