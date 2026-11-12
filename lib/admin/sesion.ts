import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { COOKIE_PANEL, DURACION_SESION_S, contrasenaPanel, crearValorSesion, sesionValida } from "./firma";

/**
 * Verifica la sesión del panel. Se llama al inicio de cada página y de cada Server Action del panel:
 * el proxy solo hace una revisión previa, la protección real es esta.
 */
export async function exigirSesionPanel(): Promise<void> {
  if (!(await haySesionPanel())) redirect("/admin/login");
}

/** ¿La solicitud trae una sesión válida del panel? */
export async function haySesionPanel(): Promise<boolean> {
  // El vencimiento se compara con la hora actual: esperar a la solicitud real (no se precarga).
  await connection();
  const valor = (await cookies()).get(COOKIE_PANEL)?.value;
  return sesionValida(valor, contrasenaPanel(), Date.now());
}

export async function abrirSesionPanel(contrasena: string): Promise<void> {
  (await cookies()).set(COOKIE_PANEL, crearValorSesion(contrasena, Date.now()), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin",
    maxAge: DURACION_SESION_S,
  });
}

export async function cerrarSesionPanel(): Promise<void> {
  (await cookies()).set(COOKIE_PANEL, "", { path: "/admin", maxAge: 0 });
}

/**
 * Preferencia "Incluir pruebas": se guarda en una cookie para que aplique en todo el panel
 * (resumen, conversaciones y errores) hasta que se desactive.
 */
const COOKIE_PRUEBAS = "panel_pruebas";

export async function incluirPruebas(): Promise<boolean> {
  return (await cookies()).get(COOKIE_PRUEBAS)?.value === "1";
}

export async function guardarIncluirPruebas(incluir: boolean): Promise<void> {
  const almacen = await cookies();
  if (!incluir) {
    almacen.set(COOKIE_PRUEBAS, "", { path: "/admin", maxAge: 0 });
    return;
  }
  almacen.set(COOKIE_PRUEBAS, "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin",
    maxAge: 365 * 24 * 60 * 60,
  });
}
