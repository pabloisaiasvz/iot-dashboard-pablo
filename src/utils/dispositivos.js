// ── Armado de la lista de dispositivos ────────────────────────
// Combina el registro (colección dispositivos/, escrita por el puente) con
// las lecturas en vivo. El registro hace que un dispositivo que dejó de
// reportar siga en la lista como OFFLINE en vez de desaparecer cuando sus
// lecturas salen de la ventana en vivo.
import { CONECTIVIDAD, LATENCIA } from "../config";
import {
  tsMs, vistoMs, calcularLatencia, estadisticas, estadoConectividad, detectarAnomalias,
} from "./telemetria";

/**
 * Agrupa por casa_id. `docs` viene ordenado por timestamp descendente y cada
 * doc puede traer `_llegadaMs` (hora en que llegó al navegador en vivo).
 * Esta parte no depende del reloj, así se memoiza solo cuando cambian los datos.
 */
export function agruparDispositivos(docs, registro = [], cfgLat = LATENCIA) {
  const mapa = new Map();

  for (const r of registro) {
    const id = r.casa_id || r.id;
    if (!id) continue;
    mapa.set(id, {
      casa_id: id,
      nombre: r.nombre || id,
      ultimo: r.ultima_medicion
        ? { casa_id: id, nombre: r.nombre, medicion: r.ultima_medicion, timestamp: r.ultimo_ts,
            evento_red: r.evento_red, intervalo_s: r.intervalo_s, desdeRegistro: true }
        : null,
      ultimoVistoMs: tsMs(r.ultimo_recibido_ts) ?? tsMs(r.ultimo_ts),
      intervaloS: r.intervalo_s ?? null,
      lecturas: [],
      registro: r,
    });
  }

  for (const d of docs) {
    const id = d.casa_id;
    if (!id) continue;
    let e = mapa.get(id);
    if (!e) {
      e = { casa_id: id, nombre: d.nombre || id, ultimo: null, ultimoVistoMs: null,
            intervaloS: null, lecturas: [], registro: null };
      mapa.set(id, e);
    }
    e.lecturas.push(d);
    const visto = vistoMs(d, d._llegadaMs);
    if (visto != null && (e.ultimoVistoMs == null || visto > e.ultimoVistoMs)) e.ultimoVistoMs = visto;
    // La primera lectura en vivo es la más nueva (orden desc) y pisa al registro
    if (!e.ultimo || e.ultimo.desdeRegistro) {
      const tReg = tsMs(e.ultimo?.timestamp);
      const tDoc = tsMs(d.timestamp);
      if (!e.ultimo || tReg == null || (tDoc != null && tDoc >= tReg)) e.ultimo = d;
    }
    if (d.nombre) e.nombre = d.nombre;
    if (d.intervalo_s && e.intervaloS == null) e.intervaloS = d.intervalo_s;
  }

  for (const e of mapa.values()) {
    const lats = e.lecturas
      .slice(0, cfgLat.ventana)
      .map((d) => ({ d, lat: calcularLatencia(d, d._llegadaMs, cfgLat) }))
      .filter((x) => x.lat);
    const utiles = lats.filter((x) => !x.lat.reenviado).map((x) => x.lat.mejor);
    e.latencia = {
      ultima: lats[0]?.lat || null,
      stats: estadisticas(utiles),
      serie: lats.slice().reverse().map(({ d, lat }) => ({
        t: tsMs(d.timestamp),
        total: lat.total,
        mejor: lat.reenviado ? null : lat.mejor,
        cola: lat.cola, red: lat.red, escritura: lat.escritura, entrega: lat.entrega,
      })),
      desfase: lats.some((x) => x.lat.desfase),
    };
    e.anomalias = detectarAnomalias(e.ultimo?.medicion);
    e.perdidos = e.registro?.mensajes_perdidos ?? 0;
  }

  return [...mapa.values()].sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
}

/** Aplica el estado de conectividad según la hora actual. */
export function aplicarConectividad(grupos, ahoraMs, cfg = CONECTIVIDAD) {
  return grupos.map((e) => ({
    ...e,
    conectividad: estadoConectividad(e.ultimoVistoMs, e.intervaloS, ahoraMs, cfg),
  }));
}

/** Si el puente publica sus parámetros de offline se usan esos. */
export function configConectividad(puente, base = CONECTIVIDAD) {
  if (!puente) return base;
  return {
    ...base,
    offlineFactor: typeof puente.offline_factor === "number" ? puente.offline_factor : base.offlineFactor,
    offlineMinS: typeof puente.offline_min_s === "number" ? puente.offline_min_s : base.offlineMinS,
  };
}

/**
 * Estado del puente MQTT→Firestore a partir de sistema/puente.
 *   desconocido  no hay documento (puente viejo o sin permisos de lectura)
 *   detenido     se apagó con Ctrl+C
 *   caido        el heartbeat dejó de actualizarse
 *   sin-broker   vivo pero sin conexión MQTT
 *   online
 */
export function estadoPuente(doc, ahoraMs, cfg = CONECTIVIDAD) {
  if (!doc) return { estado: "desconocido", edadS: null };
  const hb = tsMs(doc.heartbeat_ts) ?? tsMs(doc.heartbeat_local_ts);
  const edadS = hb != null ? Math.max(0, (ahoraMs - hb) / 1000) : null;
  const tolerancia = Math.max(cfg.puenteToleranciaS, 3 * (doc.heartbeat_intervalo_s || 15));
  if (doc.estado === "offline") return { estado: "detenido", edadS };
  if (edadS == null || edadS > tolerancia) return { estado: "caido", edadS };
  if (doc.mqtt_conectado === false) return { estado: "sin-broker", edadS };
  return { estado: "online", edadS };
}

export function resumenFlota(dispositivos) {
  const r = { total: dispositivos.length, online: 0, retrasado: 0, offline: 0, sinDatos: 0 };
  for (const d of dispositivos) {
    const e = d.conectividad?.estado;
    if (e === "online") r.online++;
    else if (e === "retrasado") r.retrasado++;
    else if (e === "offline") r.offline++;
    else r.sinDatos++;
  }
  return r;
}
