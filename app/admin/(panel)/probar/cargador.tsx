"use client";

import dynamic from "next/dynamic";

/** El chat solo se dibuja en el navegador: recupera la conversación guardada en sessionStorage. */
export const ChatPruebaCargador = dynamic(() => import("./chat").then((m) => m.ChatPrueba), {
  ssr: false,
  loading: () => <EsqueletoChat />,
});

export function EsqueletoChat() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]" aria-busy="true" aria-label="Cargando el chat">
      <div className="h-[70vh] min-h-[28rem] animate-pulse rounded-2xl bg-superficie-2 sm:h-[min(78vh,46rem)] sm:min-h-[30rem]" />
      <div className="flex flex-col gap-4">
        <div className="h-64 animate-pulse rounded-xl bg-superficie-2" />
        <div className="h-48 animate-pulse rounded-xl bg-superficie-2" />
      </div>
    </div>
  );
}
