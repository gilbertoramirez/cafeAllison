"use client";

import { useActionState } from "react";
import { login } from "../actions";

export default function LoginForm() {
  const [error, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="label" htmlFor="password">
          Contraseña
        </label>
        <input id="password" name="password" type="password" className="input" autoFocus required />
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
