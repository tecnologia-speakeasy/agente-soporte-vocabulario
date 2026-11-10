import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_PANEL, contrasenaPanel, sesionValida } from "./lib/admin/firma";

/**
 * Revisión previa del panel /admin: sin sesión válida, redirige al login antes de renderizar.
 * Solo lee la cookie (sin base de datos). Cada página y acción del panel vuelve a verificar la sesión.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/admin/login") return NextResponse.next();

  const valor = request.cookies.get(COOKIE_PANEL)?.value;
  if (sesionValida(valor, contrasenaPanel(), Date.now())) return NextResponse.next();

  const login = new URL("/admin/login", request.url);
  if (pathname !== "/admin") login.searchParams.set("siguiente", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/admin", "/admin/:path*"],
};
