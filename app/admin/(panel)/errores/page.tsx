import Link from "next/link";
import { Suspense } from "react";
import { POR_PAGINA, problemas, zonaHoraria, type TipoProblema } from "@/lib/admin/datos";
import { fechaHora, numero } from "@/lib/admin/formato";
import { exigirSesionPanel, incluirPruebas } from "@/lib/admin/sesion";
import {
  Cargando,
  EncabezadoPagina,
  InsigniaPrueba,
  Opcion,
  Paginacion,
  SinDatos,
  Tarjeta,
  conParametros,
  parametro,
} from "../ui";

const TIPOS: { valor: TipoProblema; texto: string; singular: string; explicacion: string }[] = [
  {
    valor: "error",
    texto: "Errores",
    singular: "Error",
    explicacion: "El mensaje no se pudo procesar (p. ej. falló la API de Claude, GHL o la base de datos). El usuario no recibió respuesta.",
  },
  {
    valor: "sin_terminar",
    texto: "Sin terminar",
    singular: "Sin terminar",
    explicacion: "El procesamiento se cortó sin registrar el resultado, normalmente porque la función llegó a su tiempo límite.",
  },
  {
    valor: "aviso",
    texto: "Avisos",
    singular: "Aviso",
    explicacion: "El bot respondió, pero algo falló en el camino (p. ej. no se pudo poner la etiqueta requiere_humano al escalar).",
  },
];

const ESTILO_TIPO: Record<TipoProblema, string> = {
  error: "bg-critico-fondo text-critico",
  sin_terminar: "bg-critico-fondo text-critico",
  aviso: "bg-aviso-fondo text-aviso",
};

export default function PaginaErrores(props: PageProps<"/admin/errores">) {
  return (
    <div className="flex flex-col gap-6">
      <EncabezadoPagina titulo="Errores" />
      <Suspense fallback={<Cargando filas={1} />}>
        <Contenido searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

async function Contenido({ searchParams }: { searchParams: PageProps<"/admin/errores">["searchParams"] }) {
  await exigirSesionPanel();
  const sp = await searchParams;
  const tipoTexto = parametro(sp.tipo);
  const tipo = TIPOS.find((t) => t.valor === tipoTexto)?.valor ?? null;
  const pruebas = await incluirPruebas();
  const pagina = Math.max(1, Math.floor(Number(parametro(sp.pagina)) || 1));

  const { filas, total } = await problemas({
    pruebas,
    tipo,
    limite: POR_PAGINA,
    desplazamiento: (pagina - 1) * POR_PAGINA,
  });
  const zona = zonaHoraria();
  const enlace = (cambios: { tipo?: TipoProblema | null; pagina?: number }) =>
    conParametros("/admin/errores", {
      tipo: cambios.tipo === undefined ? tipo : cambios.tipo,
      pagina: cambios.pagina && cambios.pagina > 1 ? cambios.pagina : null,
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Opcion href={enlace({ tipo: null })} activa={tipo === null}>
          Todos
        </Opcion>
        {TIPOS.map((t) => (
          <Opcion key={t.valor} href={enlace({ tipo: t.valor })} activa={tipo === t.valor}>
            {t.texto}
          </Opcion>
        ))}
      </div>

      <details className="rounded-xl border border-borde bg-superficie px-4 py-3 text-sm">
        <summary className="cursor-pointer font-semibold">¿Qué significa cada tipo?</summary>
        <dl className="mt-2 flex flex-col gap-2 text-tinta-2">
          {TIPOS.map((t) => (
            <div key={t.valor}>
              <dt className="font-semibold text-tinta">{t.texto}</dt>
              <dd>{t.explicacion}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-tinta-2">
          El detalle técnico completo también queda en los logs de Vercel (Deployments → Logs).
        </p>
      </details>

      <Tarjeta titulo={`${numero(total)} ${total === 1 ? "registro" : "registros"}`}>
        {filas.length === 0 ? (
          <SinDatos>Sin errores registrados. 🎉</SinDatos>
        ) : (
          <ul className="divide-y divide-linea text-sm">
            {filas.map((p) => (
              <li key={`${p.tipo}-${p.id}-${p.mensaje.slice(0, 30)}`} className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-start sm:gap-4">
                <div className="flex shrink-0 items-center gap-2 sm:w-52 sm:flex-col sm:items-start sm:gap-1">
                  <span className="text-tinta-2 tabular">{fechaHora(p.fecha, zona)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTILO_TIPO[p.tipo]}`}>
                    {TIPOS.find((t) => t.valor === p.tipo)?.singular ?? p.tipo}
                  </span>
                  {p.esPrueba && <InsigniaPrueba />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="break-words">{p.mensaje}</p>
                  {(p.nombre || p.contactId) && (
                    <p className="mt-0.5 text-xs text-tinta-3">Contacto: {p.nombre || p.contactId}</p>
                  )}
                </div>
                {p.sesionId && (
                  <Link
                    href={`/admin/conversaciones/${p.sesionId}`}
                    className="shrink-0 font-semibold text-morado hover:underline dark:text-fucsia"
                  >
                    Ver conversación
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        <Paginacion pagina={pagina} total={total} porPagina={POR_PAGINA} enlace={(n) => enlace({ pagina: n })} />
      </Tarjeta>
    </div>
  );
}
