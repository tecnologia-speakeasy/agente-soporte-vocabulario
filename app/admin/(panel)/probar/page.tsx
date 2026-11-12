import type { Metadata } from "next";
import { Suspense } from "react";
import { exigirSesionPanel } from "@/lib/admin/sesion";
import { disparadoresActivos } from "@/lib/bot/repo";
import { revisarEnv } from "@/lib/env";
import { Aviso, EncabezadoPagina } from "../ui";
import { ChatPruebaCargador, EsqueletoChat } from "./cargador";

export const metadata: Metadata = { title: "Probar el bot · Panel del bot" };

/** Tiempo máximo de la Server Action del chat (el bot puede llamar a Claude varias veces en un turno). */
export const maxDuration = 60;

export default function PaginaProbar() {
  return (
    <div className="flex flex-col gap-6">
      <EncabezadoPagina titulo="Probar el bot" conInterruptor={false} />
      <Suspense fallback={<EsqueletoChat />}>
        <Contenido />
      </Suspense>
    </div>
  );
}

async function Contenido() {
  await exigirSesionPanel();
  const env = revisarEnv();
  const disparadores = await disparadoresActivos();
  const frasesInicio = disparadores.filter((d) => d.tipo === "mensaje_exacto").map((d) => d.texto);
  const palabrasClave = disparadores.filter((d) => d.tipo === "palabra_clave").map((d) => d.texto);

  return (
    <div className="flex flex-col gap-4">
      {!env.ok && (
        <Aviso tono="critico" titulo="El bot no puede responder: la configuración está incompleta">
          <ul className="list-disc pl-5">
            {env.problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Aviso>
      )}
      <ChatPruebaCargador
        frasesInicio={frasesInicio}
        palabrasClave={palabrasClave}
        modelo={process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5"}
      />
    </div>
  );
}
