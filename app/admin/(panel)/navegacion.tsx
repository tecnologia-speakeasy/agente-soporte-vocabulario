"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";

const ENLACES = [
  { href: "/admin", segmento: null, texto: "Resumen" },
  { href: "/admin/conversaciones", segmento: "conversaciones", texto: "Conversaciones" },
  { href: "/admin/errores", segmento: "errores", texto: "Errores" },
] as const;

/** Menú con la sección actual resaltada (lee la URL: va dentro de <Suspense>). */
export function Navegacion() {
  const segmento = useSelectedLayoutSegment();
  return <Enlaces segmento={segmento} />;
}

/** El mismo menú sin resaltar, para mostrar mientras se resuelve la URL. */
export function NavegacionSinSeleccion() {
  return <Enlaces segmento={undefined} />;
}

function Enlaces({ segmento }: { segmento: string | null | undefined }) {
  return (
    <nav aria-label="Secciones del panel" className="flex gap-1">
      {ENLACES.map((enlace) => {
        const activo = segmento !== undefined && segmento === enlace.segmento;
        return (
          <Link
            key={enlace.href}
            href={enlace.href}
            aria-current={activo ? "page" : undefined}
            className={`border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              activo ? "border-fucsia text-white" : "border-transparent text-white/75 hover:text-white"
            }`}
          >
            {enlace.texto}
          </Link>
        );
      })}
    </nav>
  );
}
