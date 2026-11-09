"use client";

import { useActionState, useState } from "react";
import { driverSignIn } from "../actions";

export default function DriverLoginForm() {
  const [error, action, pending] = useActionState(driverSignIn, null);
  // El teléfono se conserva si el PIN fue incorrecto (el formulario se limpia tras enviarse)
  const [phone, setPhone] = useState("");
  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="label" htmlFor="phone">
          Tu teléfono
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="username"
          className="input"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="pin">
          PIN (6 números)
        </label>
        <input
          id="pin"
          name="pin"
          type="password"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="current-password"
          className="input text-center text-xl tracking-[0.5em]"
          required
        />
      </div>
      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <button className="btn-primary w-full py-3" disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
