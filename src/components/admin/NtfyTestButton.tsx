"use client";

import { useState, useTransition } from "react";
import { testNtfy } from "@/app/admin/actions";

export default function NtfyTestButton() {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn-secondary"
        disabled={pending}
        onClick={() => start(async () => setRes(await testNtfy()))}
      >
        {pending ? "Enviando…" : "🔔 Enviar prueba"}
      </button>
      {res && (
        <span className={res.ok ? "text-green-700" : "text-red-700"}>
          {res.text}
        </span>
      )}
    </div>
  );
}
