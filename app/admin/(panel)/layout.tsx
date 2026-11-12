import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { cerrarSesion } from "../acciones";
import { Navegacion, NavegacionSinSeleccion } from "./navegacion";

export const metadata: Metadata = { title: "Panel del bot de soporte" };

/**
 * Estructura del panel. No lee la sesión (así se muestra al instante):
 * cada página la verifica antes de consultar datos.
 */
export default function LayoutPanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-morado text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:gap-x-6">
          <Link href="/admin" className="flex items-center gap-3 py-1">
            <Image src="/marca/logo-speak-easy.webp" alt="Speak Easy" width={63} height={32} priority />
            <span className="leading-tight">
              <span className="block text-sm font-bold">Bot de soporte</span>
              <span className="block text-xs text-white/75">Vocabulario de Profesiones</span>
            </span>
          </Link>
          <Suspense fallback={<NavegacionSinSeleccion />}>
            <Navegacion />
          </Suspense>
          <form action={cerrarSesion} className="ml-auto">
            <button
              type="submit"
              className="rounded-lg px-2 py-1.5 text-sm whitespace-nowrap text-white/80 transition-colors hover:bg-white/10 hover:text-white sm:px-3"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
