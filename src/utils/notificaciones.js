// ── Store de notificaciones (funciones puras) ────────────────
import { NOTIFICACIONES } from "../config";

export const SEVERIDADES = ["critica", "alta", "media", "info", "ok"];
export const PESO_SEVERIDAD = { critica: 4, alta: 3, media: 2, info: 1, ok: 0 };

let contador = 0;
const nuevoId = (ahora) => `${ahora.toString(36)}-${(contador++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/**
 * Agrega una notificación. Si ya hay una con la misma `clave` dentro del
 * cooldown, se agrupa (count+1, vuelve a no leída y sube al tope) en lugar
 * de duplicarse. Devuelve { items, notificacion, agrupada }.
 */
export function agregarNotificacion(items, entrada, ahora = Date.now(), opts = {}) {
  const max = opts.max ?? NOTIFICACIONES.max;
  const cooldown = entrada.cooldownMs ?? opts.cooldownMs ?? NOTIFICACIONES.cooldownMs;
  const severidad = SEVERIDADES.includes(entrada.severidad) ? entrada.severidad : "info";

  if (entrada.clave) {
    const idx = items.findIndex((n) => n.clave === entrada.clave && ahora - n.ultimoTs < cooldown);
    if (idx !== -1) {
      const previa = items[idx];
      const notificacion = {
        ...previa,
        titulo: entrada.titulo ?? previa.titulo,
        mensaje: entrada.mensaje ?? previa.mensaje,
        severidad: PESO_SEVERIDAD[severidad] > PESO_SEVERIDAD[previa.severidad] ? severidad : previa.severidad,
        count: (previa.count || 1) + 1,
        ultimoTs: ahora,
        leida: false,
      };
      const resto = items.filter((_, i) => i !== idx);
      return { items: [notificacion, ...resto].slice(0, max), notificacion, agrupada: true };
    }
  }

  const notificacion = {
    id: nuevoId(ahora),
    clave: entrada.clave || null,
    tipo: entrada.tipo || "general",
    severidad,
    titulo: entrada.titulo || "",
    mensaje: entrada.mensaje || "",
    casa_id: entrada.casa_id || null,
    ts: ahora,
    ultimoTs: ahora,
    count: 1,
    leida: false,
  };
  return { items: [notificacion, ...items].slice(0, max), notificacion, agrupada: false };
}

export const marcarLeida = (items, id) => items.map((n) => (n.id === id ? { ...n, leida: true } : n));
export const marcarTodasLeidas = (items) => items.map((n) => (n.leida ? n : { ...n, leida: true }));
export const eliminarNotificacion = (items, id) => items.filter((n) => n.id !== id);
export const contarNoLeidas = (items) => items.reduce((s, n) => s + (n.leida ? 0 : 1), 0);

export function filtrarNotificaciones(items, filtro) {
  if (filtro === "no-leidas") return items.filter((n) => !n.leida);
  if (filtro === "criticas") return items.filter((n) => PESO_SEVERIDAD[n.severidad] >= PESO_SEVERIDAD.alta);
  if (filtro === "conectividad") return items.filter((n) => n.tipo === "conectividad" || n.tipo === "sistema");
  if (filtro === "anomalias") return items.filter((n) => n.tipo === "anomalia" || n.tipo === "red");
  return items;
}

/** Valida lo leído de localStorage (puede venir corrupto o de otra versión). */
export function sanearGuardadas(valor, max = NOTIFICACIONES.max) {
  if (!Array.isArray(valor)) return [];
  return valor
    .filter((n) => n && typeof n.id === "string" && typeof n.ts === "number")
    .map((n) => ({
      ...n,
      severidad: SEVERIDADES.includes(n.severidad) ? n.severidad : "info",
      ultimoTs: typeof n.ultimoTs === "number" ? n.ultimoTs : n.ts,
      count: n.count || 1,
      leida: !!n.leida,
    }))
    .slice(0, max);
}

/** Severidad del simulador (ALTA/MEDIA/BAJA) → severidad de notificación. */
export const severidadDesdeAlerta = (s) => ({ ALTA: "alta", MEDIA: "media", BAJA: "info" }[s] || "media");
