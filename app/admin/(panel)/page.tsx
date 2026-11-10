import Link from "next/link";
import { Suspense } from "react";
import {
  RANGOS_DIAS,
  estadoBaseDatos,
  motivosEscalado,
  problemas,
  resumen,
  serieDiaria,
  usoHerramientas,
  zonaHoraria,
  type RangoDias,
} from "@/lib/admin/datos";
import {
  NOMBRE_HERRAMIENTA,
  dolares,
  duracion,
  etiquetaMotivo,
  fechaHora,
  haceCuanto,
  numero,
  numeroCompacto,
  porcentaje,
} from "@/lib/admin/formato";
import { exigirSesionPanel } from "@/lib/admin/sesion";
import { revisarEnv } from "@/lib/env";
import { GraficaDiaria } from "./grafica-diaria";
import { Aviso, Cargando, Cifra, Opcion, SinDatos, Tarjeta, conParametros, parametro } from "./ui";

export default function PaginaResumen(props: PageProps<"/admin">) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Resumen</h1>
      <Suspense fallback={<Cargando />}>
        <Contenido searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function Contenido({ searchParams }: { searchParams: PageProps<"/admin">["searchParams"] }) {
  await exigirSesionPanel();
  const sp = await searchParams;
  const dias: RangoDias = RANGOS_DIAS.find((r) => String(r) === parametro(sp.dias)) ?? 7;
  const pruebas = parametro(sp.pruebas) === "1";
  const enlace = (cambios: { dias?: RangoDias; pruebas?: boolean }) =>
    conParametros("/admin", {
      dias: (cambios.dias ?? dias) === 7 ? null : (cambios.dias ?? dias),
      pruebas: cambios.pruebas ?? pruebas,
    });

  const bd = await estadoBaseDatos();
  if (!bd.ok) {
    return (
      <Aviso tono="critico" titulo="No se pudo conectar a la base de datos">
        <p>Revisa DATABASE_URL. Detalle: {bd.error}</p>
      </Aviso>
    );
  }
  if (bd.faltaMigracion) {
    return (
      <Aviso tono="aviso" titulo="Falta actualizar la base de datos">
        <p>
          Ejecuta <code className="font-mono">npm run db:migrate</code> para crear las tablas del panel (migración
          003_monitoreo.sql).
        </p>
      </Aviso>
    );
  }

  const filtro = { dias, pruebas };
  const [r, serie, motivos, herramientas, ultimos] = await Promise.all([
    resumen(filtro),
    serieDiaria(filtro),
    motivosEscalado(filtro),
    usoHerramientas(filtro),
    problemas({ pruebas, limite: 5 }),
  ]);
  const env = revisarEnv();
  const zona = zonaHoraria();

  const atendidos = r.mensajes.respondidos + r.mensajes.escalados;
  const procesados = atendidos + r.mensajes.errores + r.mensajes.sinTerminar;
  const errores = r.mensajes.errores + r.mensajes.sinTerminar;
  const c = r.conversaciones;
  const totalTokens = r.tokens.entrada + r.tokens.cacheLectura + r.tokens.cacheEscritura;
  const maxMotivo = Math.max(1, ...motivos.map((m) => m.total));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {RANGOS_DIAS.map((rango) => (
          <Opcion key={rango} href={enlace({ dias: rango })} activa={rango === dias}>
            Últimos {rango} días
          </Opcion>
        ))}
        <span className="mx-1 hidden h-5 w-px bg-linea sm:block" aria-hidden />
        <Opcion href={enlace({ pruebas: !pruebas })} activa={pruebas}>
          {pruebas ? "✓ Incluye pruebas" : "Incluir pruebas"}
        </Opcion>
      </div>

      {/* Estado del bot */}
      {!env.ok && (
        <Aviso tono="critico" titulo="El bot no puede responder: la configuración está incompleta">
          <ul className="list-disc pl-5">
            {env.problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Aviso>
      )}
      {env.ok && env.problemas.length > 0 && (
        <Aviso tono="aviso" titulo="Avisos de configuración">
          <ul className="list-disc pl-5">
            {env.problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Aviso>
      )}
      <p className="-mt-2 text-sm text-tinta-2">
        Último mensaje recibido de GHL: <strong className="text-tinta">{haceCuanto(r.segundosDesdeUltimoWebhook)}</strong>
        {r.ultimoModelo && (
          <>
            {" · "}Modelo: <strong className="text-tinta">{r.ultimoModelo}</strong>
          </>
        )}
      </p>

      {/* Cifras principales */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Cifra
          etiqueta="Conversaciones"
          valor={numero(c.total)}
          detalle={`${numero(c.activas)} activas ahora`}
        />
        <Cifra
          etiqueta="Mensajes atendidos"
          valor={numero(atendidos)}
          detalle={`${numero(r.mensajes.ignorados)} no eran para el bot`}
        />
        <Cifra
          etiqueta="Errores"
          valor={numero(errores)}
          tono={errores > 0 ? "critico" : "normal"}
          detalle={procesados > 0 ? `${porcentaje(errores, procesados)} de ${numero(procesados)} procesados` : "Sin mensajes procesados"}
        />
        <Cifra
          etiqueta="Costo estimado"
          valor={dolares(r.costo.total)}
          detalle={
            r.costo.porConversacion !== null
              ? `≈ ${dolares(r.costo.porConversacion)} por conversación`
              : "Sin respuestas registradas"
          }
        />
        <Cifra
          etiqueta="Tiempo de respuesta"
          valor={duracion(r.tiempo.p50)}
          detalle={r.tiempo.p95 !== null ? `Mediana · 95% en menos de ${duracion(r.tiempo.p95)}` : "Mediana"}
        />
      </div>

      <Tarjeta
        titulo="Mensajes procesados por día"
        descripcion="Mensajes que el bot respondió, escaló o no pudo procesar. No incluye los que no eran para el bot."
      >
        <GraficaDiaria datos={serie} />
      </Tarjeta>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Tarjeta
          titulo="Cómo terminan las conversaciones"
          descripcion="Conversaciones iniciadas en el periodo."
          accion={
            <Link href="/admin/conversaciones" className="text-sm font-semibold text-morado hover:underline dark:text-fucsia">
              Ver conversaciones
            </Link>
          }
        >
          {c.total === 0 ? (
            <SinDatos>No hubo conversaciones en este periodo.</SinDatos>
          ) : (
            <dl className="divide-y divide-linea text-sm">
              {[
                { texto: "Resueltas por el bot", valor: c.cerradas, estado: "cerrada" },
                { texto: "Escaladas a una persona", valor: c.escaladas, estado: "escalada" },
                { texto: "Expiraron sin cerrarse", valor: c.expiradas, estado: "expirada" },
                { texto: "Siguen activas", valor: c.activas, estado: "activa" },
              ].map((fila) => (
                <div key={fila.estado} className="flex items-center justify-between gap-4 py-2">
                  <dt>
                    <Link href={`/admin/conversaciones?estado=${fila.estado}`} className="hover:underline">
                      {fila.texto}
                    </Link>
                  </dt>
                  <dd className="tabular">
                    <span className="font-semibold">{numero(fila.valor)}</span>
                    <span className="ml-2 inline-block w-10 text-right text-tinta-3">{porcentaje(fila.valor, c.total)}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <div className="mt-4 rounded-lg bg-superficie-2 px-3 py-2 text-sm">
            <p className="font-semibold">Revisión manual</p>
            <p className="mt-0.5 text-tinta-2">
              <span className="text-exito">✓ {numero(r.revision.bien)} bien</span>
              {" · "}
              <span className="text-critico">✕ {numero(r.revision.mal)} mal</span>
              {" · "}
              <Link href="/admin/conversaciones?revision=sin" className="hover:underline">
                {numero(r.revision.sinRevisar)} sin revisar
              </Link>
            </p>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Motivos de escalado" descripcion="Por qué el bot pasó casos a una persona.">
          {motivos.length === 0 ? (
            <SinDatos>No hubo casos escalados en este periodo.</SinDatos>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {motivos.map((m) => (
                <li key={m.motivo} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3">
                  <span className="truncate" title={m.motivo}>
                    {etiquetaMotivo(m.motivo)}
                  </span>
                  <span className="h-2.5 rounded-r bg-superficie-2" aria-hidden>
                    <span
                      className="block h-full rounded-r"
                      style={{ width: `${(m.total / maxMotivo) * 100}%`, background: "var(--serie-1)" }}
                    />
                  </span>
                  <span className="font-semibold tabular">{numero(m.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>

        <Tarjeta titulo="Herramientas que usó el bot">
          {herramientas.length === 0 ? (
            <SinDatos>Todavía no hay herramientas registradas en este periodo.</SinDatos>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="text-tinta-2">
                <tr>
                  <th className="pb-2 font-semibold">Herramienta</th>
                  <th className="pb-2 text-right font-semibold">Veces</th>
                  <th className="pb-2 pl-4 font-semibold">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {herramientas.map((h) => (
                  <tr key={h.nombre} className="border-t border-linea align-top">
                    <td className="py-2">{NOMBRE_HERRAMIENTA[h.nombre] ?? h.nombre}</td>
                    <td className="py-2 text-right font-semibold tabular">{numero(h.total)}</td>
                    <td className="py-2 pl-4 text-tinta-2">
                      {h.nombre === "verificar_acceso_vocabulario" && (
                        <span className="block">
                          {numero(h.autorizados)} autorizados · {numero(h.noAutorizados)} no autorizados
                        </span>
                      )}
                      {h.errores > 0 && (
                        <span className="block">
                          {numero(h.errores)} con error o rechazadas
                        </span>
                      )}
                      {h.nombre !== "verificar_acceso_vocabulario" && h.errores === 0 && "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Tarjeta>

        <Tarjeta titulo="Consumo de Claude" descripcion="Tokens de las respuestas del periodo.">
          {r.costo.turnos === 0 ? (
            <SinDatos>Todavía no hay respuestas registradas en este periodo.</SinDatos>
          ) : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-tinta-2">Respuestas</dt>
                <dd className="font-semibold tabular">{numero(r.costo.turnos)}</dd>
              </div>
              <div>
                <dt className="text-tinta-2">Leído de la caché</dt>
                <dd className="font-semibold tabular">{porcentaje(r.tokens.cacheLectura, totalTokens)}</dd>
              </div>
              <div>
                <dt className="text-tinta-2">Tokens de entrada</dt>
                <dd className="font-semibold tabular">
                  {numeroCompacto(totalTokens)}
                  <span className="ml-1 font-normal text-tinta-3">
                    ({numeroCompacto(r.tokens.cacheLectura)} caché · {numeroCompacto(r.tokens.cacheEscritura)} escritura)
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-tinta-2">Tokens de salida</dt>
                <dd className="font-semibold tabular">{numeroCompacto(r.tokens.salida)}</dd>
              </div>
              {r.costo.turnosSinPrecio > 0 && (
                <p className="col-span-2 text-xs text-aviso">
                  {numero(r.costo.turnosSinPrecio)} respuestas usaron un modelo sin precio en la tabla (lib/precios.ts):
                  no se suman al costo.
                </p>
              )}
            </dl>
          )}
        </Tarjeta>
      </div>

      <Tarjeta
        titulo="Últimos problemas"
        accion={
          <Link href="/admin/errores" className="text-sm font-semibold text-morado hover:underline dark:text-fucsia">
            Ver todos
          </Link>
        }
      >
        {ultimos.filas.length === 0 ? (
          <SinDatos>Sin errores registrados. 🎉</SinDatos>
        ) : (
          <ul className="divide-y divide-linea text-sm">
            {ultimos.filas.map((p) => (
              <li key={`${p.tipo}-${p.id}-${p.mensaje.slice(0, 20)}`} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
                <span className="shrink-0 whitespace-nowrap text-tinta-3 tabular sm:w-40">{fechaHora(p.fecha, zona)}</span>
                <span className="min-w-0 flex-1 break-words">{p.mensaje}</span>
                {p.sesionId && (
                  <Link href={`/admin/conversaciones/${p.sesionId}`} className="shrink-0 font-semibold text-morado hover:underline dark:text-fucsia">
                    Ver conversación
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </div>
  );
}
