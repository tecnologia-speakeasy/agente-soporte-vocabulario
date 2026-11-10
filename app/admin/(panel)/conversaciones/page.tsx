import Link from "next/link";
import { Suspense } from "react";
import {
  POR_PAGINA,
  UMBRAL_CONVERSACION_LARGA,
  conversaciones,
  zonaHoraria,
  type EstadoConversacion,
  type FiltroRevision,
} from "@/lib/admin/datos";
import { ETIQUETA_ESTADO, dolares, etiquetaMotivo, fechaHora, numero } from "@/lib/admin/formato";
import { exigirSesionPanel } from "@/lib/admin/sesion";
import {
  Cargando,
  InsigniaEstado,
  InsigniaPrueba,
  InsigniaRevision,
  Paginacion,
  SinDatos,
  Tarjeta,
  conParametros,
  parametro,
} from "../ui";

const ESTADOS: EstadoConversacion[] = ["activa", "cerrada", "escalada", "expirada"];
const REVISIONES: { valor: FiltroRevision; texto: string }[] = [
  { valor: "sin", texto: "Sin revisar" },
  { valor: "bien", texto: "Revisadas: bien" },
  { valor: "mal", texto: "Revisadas: mal" },
];

export default function PaginaConversaciones(props: PageProps<"/admin/conversaciones">) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Conversaciones</h1>
      <Suspense fallback={<Cargando filas={1} />}>
        <Contenido searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function Contenido({ searchParams }: { searchParams: PageProps<"/admin/conversaciones">["searchParams"] }) {
  await exigirSesionPanel();
  const sp = await searchParams;
  const estadoTexto = parametro(sp.estado);
  const estado = ESTADOS.find((e) => e === estadoTexto) ?? null;
  const revisionTexto = parametro(sp.revision);
  const revision = REVISIONES.find((r) => r.valor === revisionTexto)?.valor ?? null;
  const largas = parametro(sp.largas) === "1";
  const conProblemas = parametro(sp.problemas) === "1";
  const pruebas = parametro(sp.pruebas) === "1";
  const busqueda = parametro(sp.q)?.trim().slice(0, 100) || null;
  const pagina = Math.max(1, Math.floor(Number(parametro(sp.pagina)) || 1));

  const { filas, total } = await conversaciones({ pruebas, estado, revision, largas, conProblemas, busqueda, pagina });
  const zona = zonaHoraria();
  const filtrosActuales = { estado, revision, largas, problemas: conProblemas, pruebas, q: busqueda };
  const hayFiltros = Boolean(estado || revision || largas || conProblemas || pruebas || busqueda);

  return (
    <div className="flex flex-col gap-4">
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-borde bg-superficie p-4">
        <div className="flex min-w-60 flex-[2] flex-col gap-1">
          <label htmlFor="q" className="text-xs font-semibold text-tinta-2">
            Buscar
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={busqueda ?? ""}
            placeholder="Nombre, teléfono o correo"
            className="rounded-lg border border-borde bg-superficie px-3 py-2 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="estado" className="text-xs font-semibold text-tinta-2">
            Estado
          </label>
          <select
            id="estado"
            name="estado"
            defaultValue={estado ?? ""}
            className="rounded-lg border border-borde bg-superficie px-3 py-2 text-sm"
          >
            <option value="">Todos</option>
            {ESTADOS.map((e) => (
              <option key={e} value={e}>
                {ETIQUETA_ESTADO[e]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="revision" className="text-xs font-semibold text-tinta-2">
            Revisión
          </label>
          <select
            id="revision"
            name="revision"
            defaultValue={revision ?? ""}
            className="rounded-lg border border-borde bg-superficie px-3 py-2 text-sm"
          >
            <option value="">Todas</option>
            {REVISIONES.map((r) => (
              <option key={r.valor} value={r.valor}>
                {r.texto}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <legend className="sr-only">Señales</legend>
          <label className="flex items-center gap-2 py-2">
            <input type="checkbox" name="largas" value="1" defaultChecked={largas} />
            Largas ({UMBRAL_CONVERSACION_LARGA}+ mensajes)
          </label>
          <label className="flex items-center gap-2 py-2">
            <input type="checkbox" name="problemas" value="1" defaultChecked={conProblemas} />
            Con errores
          </label>
          <label className="flex items-center gap-2 py-2">
            <input type="checkbox" name="pruebas" value="1" defaultChecked={pruebas} />
            Incluir pruebas
          </label>
        </fieldset>
        <div className="flex gap-2">
          <button type="submit" className="rounded-lg bg-morado px-4 py-2 text-sm font-semibold text-white hover:bg-morado-hover">
            Filtrar
          </button>
          {hayFiltros && (
            <Link href="/admin/conversaciones" className="rounded-lg border border-borde px-4 py-2 text-sm hover:bg-superficie-2">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      <Tarjeta
        titulo={`${numero(total)} ${total === 1 ? "conversación" : "conversaciones"}`}
        descripcion="Las conversaciones largas o con errores son buenas candidatas para revisar si el bot respondió bien."
      >
        {filas.length === 0 ? (
          <SinDatos>{hayFiltros ? "Ninguna conversación coincide con los filtros." : "Todavía no hay conversaciones."}</SinDatos>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="text-tinta-2">
                <tr className="border-b border-linea">
                  <th className="px-5 pb-2 font-semibold">Inicio</th>
                  <th className="pb-2 font-semibold">Contacto</th>
                  <th className="pb-2 font-semibold">Estado</th>
                  <th className="pb-2 text-right font-semibold" title="Mensajes del usuario / del bot">
                    Mensajes
                  </th>
                  <th className="pb-2 pl-4 font-semibold">Motivo de escalado</th>
                  <th className="pb-2 text-right font-semibold">Errores</th>
                  <th className="pb-2 text-right font-semibold">Costo</th>
                  <th className="px-5 pb-2 font-semibold">Revisión</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id} className="border-b border-linea last:border-0 hover:bg-superficie-2">
                    <td className="px-5 py-2.5 whitespace-nowrap text-tinta-2 tabular">{fechaHora(f.iniciadaEn, zona)}</td>
                    <td className="py-2.5">
                      <Link
                        href={`/admin/conversaciones/${f.id}`}
                        className="font-semibold text-morado hover:underline dark:text-fucsia"
                      >
                        {f.nombre || f.telefono || f.contactId}
                      </Link>
                      {f.nombre && f.telefono && <span className="block text-xs text-tinta-3">{f.telefono}</span>}
                      {f.esPrueba && (
                        <span className="mt-1 block">
                          <InsigniaPrueba />
                        </span>
                      )}
                    </td>
                    <td className="py-2.5">
                      <InsigniaEstado estado={f.estado} />
                    </td>
                    <td className="py-2.5 text-right tabular">
                      <span className={f.mensajesUsuario >= UMBRAL_CONVERSACION_LARGA ? "font-semibold text-aviso" : ""}>
                        {f.mensajesUsuario}
                      </span>
                      <span className="text-tinta-3"> / {f.mensajesBot}</span>
                    </td>
                    <td className="py-2.5 pl-4 text-tinta-2">{f.motivo ? etiquetaMotivo(f.motivo) : "—"}</td>
                    <td className="py-2.5 text-right tabular">
                      {f.problemas > 0 ? <span className="font-semibold text-critico">{f.problemas}</span> : <span className="text-tinta-3">0</span>}
                    </td>
                    <td className="py-2.5 text-right text-tinta-2 tabular">{dolares(f.costo)}</td>
                    <td className="px-5 py-2.5">
                      <InsigniaRevision revision={f.revision} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Paginacion
          pagina={pagina}
          total={total}
          porPagina={POR_PAGINA}
          enlace={(p) => conParametros("/admin/conversaciones", { ...filtrosActuales, pagina: p > 1 ? p : null })}
        />
      </Tarjeta>
    </div>
  );
}
