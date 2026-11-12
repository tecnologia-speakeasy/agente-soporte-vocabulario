import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { cambiarIncluirPruebas } from "@/app/admin/acciones";
import { ETIQUETA_ESTADO } from "@/lib/admin/formato";
import { incluirPruebas } from "@/lib/admin/sesion";
import { BotonInterruptor, Interruptor } from "./boton-interruptor";

/** Componentes visuales compartidos por las páginas del panel (Server Components). */

/** Título de la página con el interruptor "Incluir pruebas" (aplica a todo el panel). */
export function EncabezadoPagina({ titulo, conInterruptor = true }: { titulo: string; conInterruptor?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">{titulo}</h1>
      {conInterruptor && (
        <Suspense fallback={<Interruptor activo={false} texto="Incluir pruebas" deshabilitado />}>
          <InterruptorPruebas />
        </Suspense>
      )}
    </div>
  );
}

async function InterruptorPruebas() {
  const activo = await incluirPruebas();
  return (
    <form action={cambiarIncluirPruebas.bind(null, !activo)}>
      <BotonInterruptor activo={activo} texto="Incluir pruebas" />
    </form>
  );
}

type Parametro = string | number | boolean | null | undefined;

/** Arma una URL con parámetros de búsqueda, omitiendo los vacíos. */
export function conParametros(base: string, parametros: Record<string, Parametro>): string {
  const sp = new URLSearchParams();
  for (const [clave, valor] of Object.entries(parametros)) {
    if (valor === null || valor === undefined || valor === false || valor === "") continue;
    sp.set(clave, valor === true ? "1" : String(valor));
  }
  const texto = sp.toString();
  return texto ? `${base}?${texto}` : base;
}

/** Primer valor de un parámetro de búsqueda. */
export function parametro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export function Tarjeta({
  titulo,
  descripcion,
  accion,
  children,
  className = "",
}: {
  titulo?: string;
  descripcion?: ReactNode;
  accion?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-borde bg-superficie p-5 ${className}`}>
      {(titulo || accion) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            {titulo && <h2 className="text-base font-bold text-tinta">{titulo}</h2>}
            {descripcion && <p className="mt-0.5 text-sm text-tinta-2">{descripcion}</p>}
          </div>
          {accion}
        </div>
      )}
      {children}
    </section>
  );
}

export function Cifra({
  etiqueta,
  valor,
  detalle,
  tono = "normal",
}: {
  etiqueta: string;
  valor: string;
  detalle?: ReactNode;
  tono?: "normal" | "critico";
}) {
  return (
    <div className="rounded-xl border border-borde bg-superficie p-4">
      <p className="text-sm text-tinta-2">{etiqueta}</p>
      <p className={`mt-1 text-2xl font-semibold ${tono === "critico" ? "text-critico" : "text-tinta"}`}>{valor}</p>
      {detalle && <p className="mt-1 text-xs text-tinta-3">{detalle}</p>}
    </div>
  );
}

const ESTILO_ESTADO: Record<string, string> = {
  activa: "bg-info-fondo text-info",
  cerrada: "bg-exito-fondo text-exito",
  escalada: "bg-aviso-fondo text-aviso",
  expirada: "bg-superficie-2 text-tinta-2",
};

export function InsigniaEstado({ estado }: { estado: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${ESTILO_ESTADO[estado] ?? ESTILO_ESTADO.expirada}`}
    >
      {ETIQUETA_ESTADO[estado] ?? estado}
    </span>
  );
}

export function InsigniaRevision({ revision }: { revision: "bien" | "mal" | null }) {
  if (revision === "bien")
    return <span className="text-xs font-semibold whitespace-nowrap text-exito">✓ Bien</span>;
  if (revision === "mal")
    return <span className="text-xs font-semibold whitespace-nowrap text-critico">✕ Mal</span>;
  return <span className="text-xs whitespace-nowrap text-tinta-3">Sin revisar</span>;
}

export function InsigniaPrueba() {
  return (
    <span className="inline-flex items-center rounded-full border border-borde px-2 py-0.5 text-xs text-tinta-2">
      Prueba
    </span>
  );
}

export function Aviso({ tono, titulo, children }: { tono: "critico" | "aviso" | "info"; titulo?: string; children: ReactNode }) {
  const estilo = {
    critico: "bg-critico-fondo text-critico",
    aviso: "bg-aviso-fondo text-aviso",
    info: "bg-info-fondo text-info",
  }[tono];
  return (
    <div role={tono === "info" ? "status" : "alert"} className={`rounded-xl px-4 py-3 text-sm ${estilo}`}>
      {titulo && <p className="font-bold">{titulo}</p>}
      <div className={titulo ? "mt-1" : ""}>{children}</div>
    </div>
  );
}

export function Paginacion({
  pagina,
  total,
  porPagina,
  enlace,
}: {
  pagina: number;
  total: number;
  porPagina: number;
  enlace: (pagina: number) => string;
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (paginas <= 1) return null;
  const clase = "rounded-lg border border-borde px-3 py-1.5 text-sm hover:bg-superficie-2";
  return (
    <nav aria-label="Páginas" className="mt-4 flex items-center justify-between gap-2">
      {pagina > 1 ? (
        <Link href={enlace(pagina - 1)} className={clase}>
          ← Anterior
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-tinta-2">
        Página {pagina} de {paginas}
      </span>
      {pagina < paginas ? (
        <Link href={enlace(pagina + 1)} className={clase}>
          Siguiente →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** Enlace con forma de pestaña o botón de filtro. */
export function Opcion({ href, activa, children }: { href: string; activa: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={activa ? "true" : undefined}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        activa ? "bg-morado text-white" : "border border-borde text-tinta-2 hover:bg-superficie-2"
      }`}
    >
      {children}
    </Link>
  );
}

export function Cargando({ filas = 3 }: { filas?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Cargando">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-superficie-2" />
        ))}
      </div>
      {Array.from({ length: filas }, (_, i) => (
        <div key={i} className="h-48 animate-pulse rounded-xl bg-superficie-2" />
      ))}
    </div>
  );
}

export function SinDatos({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-tinta-3">{children}</p>;
}
