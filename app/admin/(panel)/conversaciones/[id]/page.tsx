import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { guardarRevision } from "@/app/admin/acciones";
import { detalleConversacion, zonaHoraria, type DetalleConversacion, type Turno } from "@/lib/admin/datos";
import {
  NOMBRE_HERRAMIENTA,
  dolares,
  duracion,
  etiquetaMotivo,
  fechaHora,
  fechaHoraCompleta,
  hora,
  numero,
  resumenHerramienta,
} from "@/lib/admin/formato";
import { exigirSesionPanel } from "@/lib/admin/sesion";
import { Cargando, InsigniaEstado, InsigniaPrueba, InsigniaRevision, Tarjeta } from "../../ui";

export default function PaginaConversacion(props: PageProps<"/admin/conversaciones/[id]">) {
  return (
    <div className="flex flex-col gap-4">
      <Link href="/admin/conversaciones" className="text-sm text-tinta-2 hover:text-tinta">
        ← Conversaciones
      </Link>
      <Suspense fallback={<Cargando filas={2} />}>
        <Contenido params={props.params} />
      </Suspense>
    </div>
  );
}

async function Contenido({ params }: { params: PageProps<"/admin/conversaciones/[id]">["params"] }) {
  await exigirSesionPanel();
  const { id } = await params;
  const sesionId = Number(id);
  if (!Number.isInteger(sesionId) || sesionId <= 0) notFound();
  const d = await detalleConversacion(sesionId);
  if (!d) notFound();

  const zona = zonaHoraria();
  const { sesion, contacto } = d;
  const totales = d.turnos.reduce(
    (t, x) => ({
      costo: t.costo + (x.costo ?? 0),
      tokens: t.tokens + x.tokensEntrada + x.tokensCacheLectura + x.tokensCacheEscritura + x.tokensSalida,
      ms: t.ms + (x.duracionMs ?? 0),
    }),
    { costo: 0, tokens: 0, ms: 0 },
  );
  const memoria = Object.entries(contacto.memoria);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{contacto.nombre || contacto.telefono || "Contacto sin nombre"}</h1>
        <InsigniaEstado estado={sesion.estado} />
        {sesion.esPrueba && <InsigniaPrueba />}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Tarjeta titulo="Conversación" descripcion="Mensajes y lo que hizo el bot en cada respuesta, en orden.">
          <LineaDeTiempo d={d} zona={zona} />
        </Tarjeta>

        <div className="flex flex-col gap-6">
          <Tarjeta titulo="Revisión">
            <FormularioRevision sesionId={sesion.id} revision={sesion.revision} nota={sesion.revisionNota} />
            {sesion.revisadaEn && (
              <p className="mt-2 text-xs text-tinta-3">Revisada el {fechaHora(sesion.revisadaEn, zona)}</p>
            )}
          </Tarjeta>

          <Tarjeta titulo="Datos">
            <dl className="flex flex-col gap-2 text-sm">
              <Dato etiqueta="Teléfono">{contacto.telefono ?? "—"}</Dato>
              <Dato etiqueta="Id de contacto (GHL)">
                <span className="font-mono text-xs break-all">{contacto.contactId}</span>
              </Dato>
              <Dato etiqueta="Inicio">{fechaHoraCompleta(sesion.iniciadaEn, zona)}</Dato>
              <Dato etiqueta="Última actividad">{fechaHoraCompleta(sesion.ultimaActividad, zona)}</Dato>
              {sesion.estado === "activa" && <Dato etiqueta="Vence">{fechaHoraCompleta(sesion.expiraEn, zona)}</Dato>}
              <Dato etiqueta="Disparador">
                {sesion.disparador ? `“${sesion.disparador.texto}”` : "—"}
              </Dato>
              <Dato etiqueta="Correos verificados">{numero(sesion.verificacionesCorreo)}</Dato>
            </dl>
          </Tarjeta>

          {(sesion.resumen || d.escalados.length > 0) && (
            <Tarjeta titulo="Cierre">
              <div className="flex flex-col gap-3 text-sm">
                {d.escalados.map((e, i) => (
                  <div key={i}>
                    <p className="font-semibold text-aviso">Escalado: {etiquetaMotivo(e.motivo)}</p>
                    <p className="mt-1 whitespace-pre-wrap text-tinta-2">{e.resumen}</p>
                  </div>
                ))}
                {sesion.resumen && (
                  <div>
                    <p className="font-semibold text-exito">Resumen del bot al cerrar</p>
                    <p className="mt-1 whitespace-pre-wrap text-tinta-2">{sesion.resumen}</p>
                  </div>
                )}
              </div>
            </Tarjeta>
          )}

          <Tarjeta titulo="Lo que el bot guardó del contacto">
            {memoria.length === 0 ? (
              <p className="text-sm text-tinta-3">Nada todavía.</p>
            ) : (
              <dl className="flex flex-col gap-2 text-sm">
                {memoria.map(([clave, valor]) => (
                  <Dato key={clave} etiqueta={clave.replace(/_/g, " ")}>
                    <span className="break-words">{String(valor)}</span>
                  </Dato>
                ))}
              </dl>
            )}
          </Tarjeta>

          <Tarjeta titulo="Consumo">
            <dl className="flex flex-col gap-2 text-sm">
              <Dato etiqueta="Respuestas del bot">{numero(d.turnos.length)}</Dato>
              <Dato etiqueta="Tokens">{numero(totales.tokens)}</Dato>
              <Dato etiqueta="Costo estimado">{dolares(totales.costo)}</Dato>
              <Dato etiqueta="Tiempo total respondiendo">{duracion(totales.ms)}</Dato>
            </dl>
          </Tarjeta>

          {d.otras.length > 0 && (
            <Tarjeta titulo="Otras conversaciones del contacto">
              <ul className="flex flex-col gap-2 text-sm">
                {d.otras.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-2">
                    <Link href={`/admin/conversaciones/${o.id}`} className="text-morado hover:underline dark:text-fucsia">
                      {fechaHora(o.iniciadaEn, zona)}
                    </Link>
                    <InsigniaEstado estado={o.estado} />
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}
        </div>
      </div>
    </div>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-tinta-3 first-letter:uppercase">{etiqueta}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function FormularioRevision({
  sesionId,
  revision,
  nota,
}: {
  sesionId: number;
  revision: "bien" | "mal" | null;
  nota: string | null;
}) {
  const accion = guardarRevision.bind(null, sesionId);
  const boton = "flex-1 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors";
  return (
    <form action={accion} className="flex flex-col gap-3">
      <p className="text-sm">
        Estado: <InsigniaRevision revision={revision} />
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor="nota" className="text-xs font-semibold text-tinta-2">
          Nota (opcional)
        </label>
        <textarea
          id="nota"
          name="nota"
          rows={3}
          maxLength={2000}
          defaultValue={nota ?? ""}
          placeholder="Qué estuvo bien o qué debió responder distinto"
          className="rounded-lg border border-borde bg-superficie px-3 py-2 text-sm"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          name="revision"
          value="bien"
          className={`${boton} ${revision === "bien" ? "border-exito bg-exito-fondo text-exito" : "border-borde hover:bg-superficie-2"}`}
        >
          ✓ Respondió bien
        </button>
        <button
          type="submit"
          name="revision"
          value="mal"
          className={`${boton} ${revision === "mal" ? "border-critico bg-critico-fondo text-critico" : "border-borde hover:bg-superficie-2"}`}
        >
          ✕ Respondió mal
        </button>
      </div>
      {revision && (
        <button type="submit" name="revision" value="quitar" className="text-xs text-tinta-3 hover:text-tinta hover:underline">
          Quitar revisión
        </button>
      )}
    </form>
  );
}

// ---------- Línea de tiempo ----------

type Elemento =
  | { tipo: "mensaje"; fecha: Date; orden: number; rol: "user" | "assistant"; contenido: string }
  | { tipo: "turno"; fecha: Date; orden: number; turno: Turno }
  | { tipo: "error_webhook"; fecha: Date; orden: number; resultado: string | null; detalle: string | null };

function LineaDeTiempo({ d, zona }: { d: DetalleConversacion; zona: string }) {
  const elementos: Elemento[] = [
    ...d.mensajes.map((m) => ({ tipo: "mensaje" as const, fecha: m.fecha, orden: 0, rol: m.rol, contenido: m.contenido })),
    ...d.turnos.map((t) => ({ tipo: "turno" as const, fecha: t.iniciadoEn, orden: 1, turno: t })),
    // Errores del webhook que no quedaron registrados en un turno (la consulta ya excluye los repetidos).
    ...d.erroresWebhook.map((w) => ({
      tipo: "error_webhook" as const,
      fecha: w.fecha,
      orden: 2,
      resultado: w.resultado,
      detalle: w.detalle,
    })),
  ].sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || a.orden - b.orden);

  if (elementos.length === 0) return <p className="text-sm text-tinta-3">Sin mensajes.</p>;

  return (
    <ol className="flex flex-col gap-3">
      {elementos.map((e, i) => {
        if (e.tipo === "mensaje") {
          const esUsuario = e.rol === "user";
          return (
            <li key={i} className={`flex ${esUsuario ? "justify-start" : "justify-end"}`}>
              <div
                className={`max-w-[85%] rounded-2xl border border-borde px-3.5 py-2 text-sm ${
                  esUsuario ? "rounded-bl-sm bg-burbuja-usuario" : "rounded-br-sm bg-burbuja-bot"
                }`}
              >
                <p className="mb-0.5 text-xs font-semibold text-tinta-3">
                  {esUsuario ? "Usuario" : "Bot"} · {hora(e.fecha, zona)}
                </p>
                <p className="whitespace-pre-wrap break-words">{e.contenido}</p>
              </div>
            </li>
          );
        }
        if (e.tipo === "turno") return <li key={i}><TarjetaTurno turno={e.turno} /></li>;
        return (
          <li key={i} className="rounded-lg bg-critico-fondo px-3 py-2 text-sm text-critico">
            <p className="font-semibold">
              {e.resultado === null ? "El procesamiento no terminó" : "Error al procesar un mensaje"} · {hora(e.fecha, zona)}
            </p>
            {e.detalle && <p className="mt-0.5 break-words">{e.detalle}</p>}
          </li>
        );
      })}
    </ol>
  );
}

function TarjetaTurno({ turno }: { turno: Turno }) {
  const conProblema = turno.resultado === "error";
  return (
    <div
      className={`mx-auto w-full max-w-[95%] rounded-lg border px-3 py-2 text-xs ${
        conProblema ? "border-critico bg-critico-fondo" : "border-dashed border-borde bg-superficie-2"
      }`}
    >
      <p className="text-tinta-2">
        <span className="font-semibold text-tinta">Bot procesó</span>
        {" · "}
        {duracion(turno.duracionMs)}
        {" · "}
        {turno.llamadas} {turno.llamadas === 1 ? "llamada" : "llamadas"} a Claude
        {" · "}
        {dolares(turno.costo)}
        {turno.resultado === "escalado" && <span className="font-semibold text-aviso"> · escaló el caso</span>}
      </p>
      {turno.herramientas.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {turno.herramientas.map((h, i) => (
            <li key={i}>
              <details>
                <summary className="cursor-pointer">
                  <span className={h.error ? "text-critico" : "text-tinta"}>
                    🔧 {NOMBRE_HERRAMIENTA[h.nombre] ?? h.nombre}
                  </span>
                  <span className="text-tinta-2"> → {resumenHerramienta(h)}</span>
                </summary>
                <div className="mt-1 grid gap-1 rounded bg-superficie p-2 font-mono text-[11px] break-all">
                  <p>
                    <span className="text-tinta-3">entrada: </span>
                    {JSON.stringify(h.entrada)}
                  </p>
                  <p>
                    <span className="text-tinta-3">resultado: </span>
                    {typeof h.resultado === "string" ? h.resultado : JSON.stringify(h.resultado)}
                  </p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
      {turno.detalle && turno.resultado !== "respondido" && <p className="mt-1.5 text-tinta-2">{turno.detalle}</p>}
      {turno.error && <p className="mt-1.5 font-semibold break-words text-critico">Error: {turno.error}</p>}
      {turno.avisos.map((a, i) => (
        <p key={i} className="mt-1.5 rounded bg-aviso-fondo px-2 py-1 break-words text-aviso">
          ⚠ {a}
        </p>
      ))}
      {turno.stopReason === "max_tokens" && (
        <p className="mt-1.5 text-aviso">La respuesta se cortó por el límite de tokens.</p>
      )}
    </div>
  );
}
