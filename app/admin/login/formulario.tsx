"use client";

import { useActionState } from "react";
import { iniciarSesion, type EstadoLogin } from "../acciones";

const inicial: EstadoLogin = { error: null };

export function FormularioLogin({ siguiente }: { siguiente: string }) {
  const [estado, accion, pendiente] = useActionState(iniciarSesion, inicial);

  return (
    <form action={accion} className="flex flex-col gap-4">
      <input type="hidden" name="siguiente" value={siguiente} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="contrasena" className="text-sm font-semibold text-tinta">
          Contraseña
        </label>
        <input
          id="contrasena"
          name="contrasena"
          type="password"
          required
          autoComplete="current-password"
          autoFocus
          aria-invalid={estado.error ? true : undefined}
          aria-describedby={estado.error ? "error-login" : undefined}
          className="rounded-lg border border-borde bg-superficie px-3 py-2.5 text-base text-tinta outline-none focus-visible:border-fucsia"
        />
      </div>
      {estado.error && (
        <p id="error-login" role="alert" className="rounded-lg bg-critico-fondo px-3 py-2 text-sm text-critico">
          {estado.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pendiente}
        className="rounded-lg bg-morado px-4 py-2.5 font-semibold text-white transition-colors hover:bg-morado-hover disabled:opacity-60"
      >
        {pendiente ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
