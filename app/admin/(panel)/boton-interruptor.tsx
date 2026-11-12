"use client";

import { useFormStatus } from "react-dom";

/** Botón con forma de interruptor; se atenúa mientras se guarda el cambio. */
export function BotonInterruptor({ activo, texto }: { activo: boolean; texto: string }) {
  const { pending } = useFormStatus();
  return <Interruptor activo={activo} texto={texto} pendiente={pending} />;
}

export function Interruptor({
  activo,
  texto,
  pendiente = false,
  deshabilitado = false,
}: {
  activo: boolean;
  texto: string;
  pendiente?: boolean;
  deshabilitado?: boolean;
}) {
  return (
    <button
      type="submit"
      aria-pressed={activo}
      aria-busy={pendiente || undefined}
      disabled={deshabilitado || pendiente}
      className={`inline-flex items-center gap-2 rounded-lg border border-borde bg-superficie px-3 py-1.5 text-sm font-medium text-tinta-2 transition-colors enabled:hover:bg-superficie-2 enabled:hover:text-tinta ${
        pendiente ? "opacity-60" : ""
      } ${deshabilitado ? "cursor-default" : ""}`}
    >
      <span
        aria-hidden
        className={`relative inline-block h-4 w-7 shrink-0 rounded-full transition-colors ${
          activo ? "bg-morado dark:bg-fucsia" : "bg-tinta-3"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-3 rounded-full bg-white shadow-sm transition-transform ${
            activo ? "translate-x-3" : ""
          }`}
        />
      </span>
      {texto}
    </button>
  );
}
