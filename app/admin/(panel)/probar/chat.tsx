"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { ETIQUETA_ESTADO, dolares, duracion } from "@/lib/admin/formato";
import { enviarMensajePrueba, type HerramientaChat, type RespuestaChat } from "./acciones";

/**
 * Chat para probar el bot desde el panel: cada mensaje recorre el mismo flujo que uno de WhatsApp
 * (Claude y base de datos reales) pero sin tocar GHL. La conversación se guarda en sessionStorage
 * para no perderla al cambiar de sección del panel.
 */

const CLAVE_GUARDADO = "panel:chat-prueba:v1";
const MAX_CARACTERES = 2000;

type Tono = "info" | "aviso" | "exito" | "critico";
type EstadoSesion = "activa" | "escalada" | "cerrada";

type Elemento =
  | { id: string; tipo: "usuario"; texto: string; hora: number }
  | { id: string; tipo: "bot"; texto: string; hora: number }
  | {
      id: string;
      tipo: "detalle";
      herramientas: HerramientaChat[];
      ghl: string[];
      costoUsd: number | null;
      duracionMs: number | null;
    }
  | { id: string; tipo: "evento"; tono: Tono; texto: string; entrar?: boolean };

interface EstadoChat {
  version: 1;
  /** Contacto simulado (se crea con el primer mensaje). */
  contacto: string | null;
  nombre: string;
  elementos: Elemento[];
  sesionId: number | null;
  estado: EstadoSesion | null;
  enviados: number;
  costoTotal: number;
}

const chatVacio = (nombre = "Prueba"): EstadoChat => ({
  version: 1,
  contacto: null,
  nombre,
  elementos: [],
  sesionId: null,
  estado: null,
  enviados: 0,
  costoTotal: 0,
});

function leerGuardado(): EstadoChat {
  try {
    const crudo = sessionStorage.getItem(CLAVE_GUARDADO);
    if (!crudo) return chatVacio();
    const guardado = JSON.parse(crudo) as EstadoChat;
    return guardado?.version === 1 && Array.isArray(guardado.elementos) ? guardado : chatVacio();
  } catch {
    return chatVacio();
  }
}

const nuevoId = () => crypto.randomUUID();
const nuevoContacto = () => `panel-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

const formatoHora = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit" });

/** Convierte la respuesta del servidor en elementos del chat. */
function elementosDeRespuesta(r: RespuestaChat): Elemento[] {
  if (!r.ok) return [{ id: nuevoId(), tipo: "evento", tono: "critico", texto: r.error, entrar: r.sesionVencida }];

  const ahora = Date.now();
  const nuevos: Elemento[] = r.mensajes.map((texto) => ({ id: nuevoId(), tipo: "bot", texto, hora: ahora }));
  if (r.herramientas.length > 0 || r.ghl.length > 0 || r.duracionMs !== null) {
    nuevos.push({
      id: nuevoId(),
      tipo: "detalle",
      herramientas: r.herramientas,
      ghl: r.ghl,
      costoUsd: r.costoUsd,
      duracionMs: r.duracionMs,
    });
  }
  for (const aviso of r.avisos) nuevos.push({ id: nuevoId(), tipo: "evento", tono: "aviso", texto: `Aviso: ${aviso}` });

  if (r.ignorado) {
    const sinDisparador = r.resultado === "ignorado_sin_sesion" && r.sesionId === null;
    nuevos.push({
      id: nuevoId(),
      tipo: "evento",
      tono: "info",
      texto: sinDisparador
        ? "El bot no respondió: el mensaje no tiene una frase de inicio ni una palabra clave, y no hay una conversación abierta. En WhatsApp pasaría lo mismo."
        : `El bot no respondió: ${r.detalle ?? r.resultado}`,
    });
  } else if (r.estado === "escalada") {
    nuevos.push({
      id: nuevoId(),
      tipo: "evento",
      tono: "aviso",
      texto: "El caso pasó a una persona del equipo. En WhatsApp, el bot ya no le respondería a este contacto.",
    });
  } else if (r.estado === "cerrada") {
    nuevos.push({
      id: nuevoId(),
      tipo: "evento",
      tono: "exito",
      texto: "El bot cerró el caso como resuelto. Si escribes otra vez, solo responderá a una frase de inicio o una palabra clave.",
    });
  } else if (r.mensajes.length === 0 && r.detalle) {
    nuevos.push({ id: nuevoId(), tipo: "evento", tono: "info", texto: r.detalle });
  }
  return nuevos;
}

function ajustarAltura(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

export function ChatPrueba({
  frasesInicio,
  palabrasClave,
  modelo,
}: {
  frasesInicio: string[];
  palabrasClave: string[];
  modelo: string;
}) {
  const [chat, setChat] = useState<EstadoChat>(leerGuardado);
  const [texto, setTexto] = useState("");
  const [pendiente, iniciarTransicion] = useTransition();
  const listaRef = useRef<HTMLDivElement>(null);
  const entradaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(CLAVE_GUARDADO, JSON.stringify(chat));
    } catch {
      // Sin almacenamiento (modo privado o lleno): el chat sigue funcionando, solo no se conserva.
    }
  }, [chat]);

  // Mantener visible el último mensaje.
  useEffect(() => {
    const lista = listaRef.current;
    if (lista) lista.scrollTo({ top: lista.scrollHeight, behavior: "smooth" });
  }, [chat.elementos.length, chat.estado, pendiente]);

  const escalado = chat.estado === "escalada";
  const sugerencias = [...new Set([...frasesInicio, "¿Dónde está mi vocabulario?", "¿Cómo elijo la profesión de mi vocabulario?"])];

  function enviar(mensaje: string) {
    const limpio = mensaje.trim().slice(0, MAX_CARACTERES);
    if (!limpio || pendiente || escalado) return;
    const contacto = chat.contacto ?? nuevoContacto();
    const nombre = chat.nombre.trim() || "Prueba";
    const propio: Elemento = { id: nuevoId(), tipo: "usuario", texto: limpio, hora: Date.now() };
    setChat((c) => ({ ...c, contacto, enviados: c.enviados + 1, elementos: [...c.elementos, propio] }));
    setTexto("");
    if (entradaRef.current) entradaRef.current.style.height = "auto";

    iniciarTransicion(async () => {
      let r: RespuestaChat;
      try {
        r = await enviarMensajePrueba({ contacto, mensaje: limpio, nombre });
      } catch {
        r = { ok: false, error: "No hubo respuesta del servidor. Revisa la conexión e inténtalo de nuevo." };
      }
      const nuevos = elementosDeRespuesta(r);
      setChat((c) => ({
        ...c,
        elementos: [...c.elementos, ...nuevos],
        sesionId: r.ok ? (r.sesionId ?? c.sesionId) : c.sesionId,
        estado: r.ok ? (r.estado ?? c.estado) : c.estado,
        costoTotal: c.costoTotal + (r.ok ? (r.costoUsd ?? 0) : 0),
      }));
    });
  }

  function nuevoChat() {
    setChat((c) => chatVacio(c.nombre));
    setTexto("");
    requestAnimationFrame(() => entradaRef.current?.focus());
  }

  function alPresionarTecla(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      enviar(texto);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <section
        aria-label="Chat de prueba"
        className="flex h-[70vh] min-h-[28rem] flex-col overflow-hidden sm:h-[min(78vh,46rem)] sm:min-h-[30rem] rounded-2xl border border-borde bg-superficie shadow-sm"
      >
        {/* Cabecera */}
        <div className="flex items-center gap-3 bg-morado px-4 py-3 text-white">
          <Image src="/marca/logo-speak-easy.webp" alt="Speak Easy" width={47} height={24} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-bold">Bot de soporte · Vocabulario</p>
            <p className="flex items-center gap-1.5 text-xs text-white/80">
              <span
                aria-hidden
                className={`inline-block size-2 rounded-full ${escalado ? "bg-white/50" : "bg-[#5ee08a]"}`}
              />
              {pendiente ? "escribiendo…" : escalado ? "caso con una persona" : "en línea · modo prueba"}
            </p>
          </div>
          <span className="hidden max-w-40 truncate rounded-full bg-white/10 px-2.5 py-1 font-mono text-[11px] text-white/85 sm:inline" title="Modelo de Claude configurado">
            {modelo}
          </span>
        </div>

        {/* Mensajes */}
        <div ref={listaRef} className="flex-1 overflow-y-auto bg-plano px-3 py-4 sm:px-5">
          {chat.elementos.length === 0 && !pendiente ? (
            <Bienvenida sugerencias={sugerencias} alElegir={enviar} />
          ) : (
            <ol role="log" aria-label="Mensajes de la prueba" className="flex flex-col gap-2">
              {chat.elementos.map((e, i) => (
                <ElementoChat key={e.id} elemento={e} conAvatar={e.tipo === "bot" && chat.elementos[i - 1]?.tipo !== "bot"} />
              ))}
            </ol>
          )}
          {pendiente && <Escribiendo />}
        </div>

        {/* Entrada */}
        {escalado ? (
          <div className="flex flex-col items-center gap-2 border-t border-borde bg-superficie px-4 py-3 text-center sm:flex-row sm:text-left">
            <p className="flex-1 text-sm text-tinta-2">
              El bot ya no responde en esta conversación porque la pasó a una persona.
            </p>
            <button
              type="button"
              onClick={nuevoChat}
              className="rounded-lg bg-morado px-4 py-2 text-sm font-semibold text-white hover:bg-morado-hover"
            >
              Empezar un chat nuevo
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              enviar(texto);
            }}
            className="border-t border-borde bg-superficie p-3 sm:pb-2"
          >
            <div className="flex items-end gap-2">
              <label htmlFor="mensaje-prueba" className="sr-only">
                Mensaje para el bot
              </label>
              <textarea
                id="mensaje-prueba"
                ref={entradaRef}
                rows={1}
                value={texto}
                maxLength={MAX_CARACTERES}
                onChange={(e) => {
                  setTexto(e.target.value);
                  ajustarAltura(e.currentTarget);
                }}
                onKeyDown={alPresionarTecla}
                placeholder="Escribe un mensaje…"
                className="max-h-40 min-h-11 flex-1 resize-none rounded-3xl border border-borde bg-plano px-4 py-2.5 text-sm leading-5 placeholder:text-tinta-3"
              />
              <button
                type="submit"
                disabled={!texto.trim() || pendiente}
                aria-label="Enviar mensaje"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-fucsia text-white shadow-sm transition enabled:hover:brightness-95 disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" className="size-5 translate-x-px" fill="currentColor" aria-hidden>
                  <path d="M3.4 20.4 21 12 3.4 3.6l.01 6.53L15 12l-11.59 1.87z" />
                </svg>
              </button>
            </div>
            <p className="mt-1.5 hidden px-2 text-[11px] text-tinta-3 sm:block">
              Enter para enviar · Shift + Enter para un salto de línea
            </p>
          </form>
        )}
      </section>

      {/* Panel lateral */}
      <aside className="flex flex-col gap-4">
        <div className="rounded-xl border border-borde bg-superficie p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-base font-bold">Esta prueba</h2>
            <button
              type="button"
              onClick={nuevoChat}
              disabled={pendiente || chat.elementos.length === 0}
              className="rounded-lg border border-borde px-3 py-1.5 text-sm font-semibold text-tinta-2 enabled:hover:bg-superficie-2 enabled:hover:text-tinta disabled:opacity-50"
            >
              Nuevo chat
            </button>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="nombre-prueba" className="text-xs font-semibold text-tinta-2">
              Nombre del estudiante
            </label>
            <input
              id="nombre-prueba"
              value={chat.nombre}
              maxLength={80}
              onChange={(e) => {
                const nombre = e.target.value;
                setChat((c) => ({ ...c, nombre }));
              }}
              className="rounded-lg border border-borde bg-superficie px-3 py-2 text-sm"
            />
            <p className="text-xs text-tinta-3">El bot lo usa para saludar, como el nombre del contacto en GHL.</p>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div className="col-span-2">
              <dt className="text-xs text-tinta-3">Estado</dt>
              <dd className="mt-0.5">
                <InsigniaEstadoChat estado={chat.estado} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-tinta-3">Mensajes enviados</dt>
              <dd className="font-semibold tabular">{chat.enviados}</dd>
            </div>
            <div>
              <dt className="text-xs text-tinta-3">Costo de la prueba</dt>
              <dd className="font-semibold tabular">{dolares(chat.costoTotal)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-tinta-3">Conversación</dt>
              <dd>
                {chat.sesionId !== null ? (
                  <a
                    href={`/admin/conversaciones/${chat.sesionId}`}
                    target="_blank"
                    rel="noopener"
                    className="font-semibold text-morado hover:underline dark:text-fucsia"
                  >
                    Ver el detalle completo ↗
                  </a>
                ) : (
                  <span className="text-tinta-3">Se crea cuando el bot se activa</span>
                )}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-borde bg-superficie p-5 text-sm">
          <h2 className="text-base font-bold">Qué activa el bot</h2>
          <p className="mt-3 text-xs font-semibold text-tinta-2">Frases exactas (el mensaje debe ser solo esa frase)</p>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {frasesInicio.map((f) => (
              <li key={f}>
                <button
                  type="button"
                  onClick={() => enviar(f)}
                  disabled={pendiente || escalado}
                  className="text-left text-morado enabled:hover:underline disabled:opacity-50 dark:text-fucsia"
                >
                  “{f}”
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs font-semibold text-tinta-2">Palabras clave (en cualquier parte del mensaje)</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {palabrasClave.map((p) => (
              <li key={p} className="rounded-full bg-superficie-2 px-2.5 py-0.5 text-xs text-tinta-2">
                {p}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl bg-info-fondo px-4 py-3 text-sm text-info">
          <p className="font-bold">Cómo funciona</p>
          <p className="mt-1">
            Usa Claude y la base de datos reales, así que la verificación de correos es de verdad. No envía nada por
            WhatsApp ni toca GHL: la etiqueta, el campo y la nota del escalado solo se simulan.
          </p>
          <p className="mt-2">
            Estas conversaciones quedan marcadas como prueba. Para verlas en Conversaciones, activa «Incluir pruebas».
          </p>
        </div>
      </aside>
    </div>
  );
}

// ---------- Piezas del chat ----------

function IconoBot({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 4.5V8" />
      <circle cx="12" cy="3.5" r="1" />
      <circle cx="9" cy="13.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Avatar({ visible = true }: { visible?: boolean }) {
  if (!visible) return <span className="w-7 shrink-0" aria-hidden />;
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-morado text-white dark:bg-fucsia" aria-hidden>
      <IconoBot className="size-4" />
    </span>
  );
}

function Bienvenida({ sugerencias, alElegir }: { sugerencias: string[]; alElegir: (texto: string) => void }) {
  return (
    <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 py-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-morado text-white dark:bg-fucsia" aria-hidden>
        <IconoBot className="size-7" />
      </span>
      <div>
        <p className="font-bold">Habla con el bot como si fueras un estudiante</p>
        <p className="mt-1 text-sm text-tinta-2">
          Como en WhatsApp, el bot solo se activa con una frase de inicio o un mensaje con una palabra clave. Prueba con:
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {sugerencias.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => alElegir(s)}
            className="rounded-full border border-borde bg-superficie px-3 py-1.5 text-sm text-tinta shadow-sm transition-colors hover:border-morado hover:text-morado dark:hover:border-fucsia dark:hover:text-fucsia"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Escribiendo() {
  return (
    <div className="mt-2 flex items-end gap-2">
      <Avatar />
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-borde bg-superficie px-4 py-3.5 shadow-sm">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 rounded-full bg-tinta-3 motion-safe:animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
        <span className="sr-only">El bot está escribiendo</span>
      </div>
    </div>
  );
}

const ESTILO_EVENTO: Record<Tono, string> = {
  info: "bg-superficie-2 text-tinta-2",
  aviso: "bg-aviso-fondo text-aviso",
  exito: "bg-exito-fondo text-exito",
  critico: "bg-critico-fondo text-critico",
};

function ElementoChat({ elemento: e, conAvatar }: { elemento: Elemento; conAvatar: boolean }) {
  switch (e.tipo) {
    case "usuario":
      return (
        <li className="flex justify-end pl-10">
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-morado px-3.5 py-2 text-sm text-white shadow-sm sm:max-w-[75%]">
            <p className="whitespace-pre-wrap break-words">{e.texto}</p>
            <p className="mt-0.5 text-right text-[11px] text-white/70">{formatoHora.format(e.hora)}</p>
          </div>
        </li>
      );
    case "bot":
      return (
        <li className={`flex items-end gap-2 pr-10 ${conAvatar ? "mt-1" : ""}`}>
          <Avatar visible={conAvatar} />
          <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-borde bg-superficie px-3.5 py-2 text-sm shadow-sm sm:max-w-[75%]">
            <p className="whitespace-pre-wrap break-words">
              <TextoWhatsApp texto={e.texto} />
            </p>
            <p className="mt-0.5 text-right text-[11px] text-tinta-3">{formatoHora.format(e.hora)}</p>
          </div>
        </li>
      );
    case "detalle":
      return (
        <li className="flex flex-wrap items-center gap-1.5 pl-9 text-xs text-tinta-3">
          {e.herramientas.map((h, i) => (
            <span
              key={i}
              className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 ${
                h.error ? "border-critico/30 bg-critico-fondo text-critico" : "border-borde bg-superficie text-tinta-2"
              }`}
              title={`${h.etiqueta}: ${h.resumen}`}
            >
              <span aria-hidden>🔧</span>
              <span className="font-semibold whitespace-nowrap">{h.etiqueta}</span>
              <span className="truncate">· {h.resumen}</span>
            </span>
          ))}
          {e.ghl.map((g, i) => (
            <span key={`g${i}`} className="inline-flex items-center gap-1 rounded-full border border-dashed border-borde px-2 py-0.5">
              GHL simulado · {g}
            </span>
          ))}
          {e.duracionMs !== null && (
            <span className="tabular">
              {duracion(e.duracionMs)} · {dolares(e.costoUsd)}
            </span>
          )}
        </li>
      );
    case "evento":
      return (
        <li className="my-1 flex justify-center">
          <p className={`max-w-[92%] rounded-lg px-3 py-1.5 text-center text-xs ${ESTILO_EVENTO[e.tono]}`}>
            {e.texto}
            {e.entrar && (
              <a href="/admin/login?siguiente=/admin/probar" className="ml-1 font-semibold underline">
                Entrar
              </a>
            )}
          </p>
        </li>
      );
  }
}

/** Texto con enlaces clicables y *negritas* como en WhatsApp. */
function TextoWhatsApp({ texto }: { texto: string }) {
  const partes: ReactNode[] = [];
  const patron = /(https?:\/\/[^\s]+[^\s.,;:!?)\]]|\*[^*\n]+\*)/g;
  let ultimo = 0;
  for (const m of texto.matchAll(patron)) {
    const inicio = m.index ?? 0;
    if (inicio > ultimo) partes.push(texto.slice(ultimo, inicio));
    const valor = m[0];
    partes.push(
      valor.startsWith("*") ? (
        <strong key={inicio}>{valor.slice(1, -1)}</strong>
      ) : (
        <a key={inicio} href={valor} target="_blank" rel="noopener noreferrer" className="break-all text-morado underline dark:text-fucsia">
          {valor}
        </a>
      ),
    );
    ultimo = inicio + valor.length;
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return <>{partes}</>;
}

const ESTILO_ESTADO: Record<EstadoSesion, string> = {
  activa: "bg-info-fondo text-info",
  cerrada: "bg-exito-fondo text-exito",
  escalada: "bg-aviso-fondo text-aviso",
};

function InsigniaEstadoChat({ estado }: { estado: EstadoSesion | null }) {
  if (!estado) return <span className="text-sm text-tinta-3">Sin conversación todavía</span>;
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${ESTILO_ESTADO[estado]}`}>
      {ETIQUETA_ESTADO[estado]}
    </span>
  );
}
