// ── Lógica pura sobre lecturas de telemetría ──────────────────
// Sin React ni Firebase: todo lo de acá se testea en telemetria.test.js.
import { UMBRALES, CONECTIVIDAD, LATENCIA } from "../config";

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Cualquier representación de tiempo → epoch ms (o null).
 *  Acepta ISO string, Firestore Timestamp, Date o número. */
export function tsMs(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === "string") {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof v.seconds === "number") return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
  return null;
}

// ── Anomalías ─────────────────────────────────────────────────
// Mismas reglas que detectar_anomalias() del simulador.
export function detectarAnomalias(m, u = UMBRALES) {
  if (!m) return [];
  const out = [];
  const t = num(m.tension_v);
  const c = num(m.consumo_w);
  const fp = num(m.factor_potencia);
  const f = num(m.frecuencia_hz);

  if (t != null && t < u.tensionMin)
    out.push({ tipo: "BAJA_TENSION", severidad: t < u.tensionBajaCritica ? "ALTA" : "MEDIA", valor: t,
      descripcion: `Tensión ${t} V bajo mínimo (${u.tensionMin} V)` });
  if (t != null && t > u.tensionMax)
    out.push({ tipo: "SOBRETENSION", severidad: t > u.tensionAltaCritica ? "ALTA" : "MEDIA", valor: t,
      descripcion: `Tensión ${t} V sobre máximo (${u.tensionMax} V)` });
  if (c != null && c > u.consumoMax)
    out.push({ tipo: "PICO_CONSUMO", severidad: c > u.consumoCritico ? "ALTA" : "MEDIA", valor: c,
      descripcion: `Consumo ${c} W sobre máximo (${u.consumoMax} W)` });
  if (fp != null && fp < u.fpMin)
    out.push({ tipo: "FACTOR_POTENCIA_BAJO", severidad: "BAJA", valor: fp,
      descripcion: `FP ${fp} bajo mínimo (${u.fpMin})` });
  if (f != null && (f < u.frecuenciaMin || f > u.frecuenciaMax))
    out.push({ tipo: "FRECUENCIA_ANORMAL", severidad: "ALTA", valor: f,
      descripcion: `Frecuencia ${f} Hz fuera de rango (${u.frecuenciaMin}-${u.frecuenciaMax} Hz)` });
  return out;
}

export const tieneAnomalia = (m) => detectarAnomalias(m).length > 0;

// ── Latencia ──────────────────────────────────────────────────
/**
 * Latencia por etapa (ms) de una lectura.
 *
 *   timestamp ──cola──▶ enviado_ts ──red──▶ recibido_ts ──escritura──▶ servidor_ts ──entrega──▶ llegada
 *   (medición)          (publish MQTT)      (puente)                   (Firestore)             (navegador)
 *
 * total = llegada − timestamp (solo si vimos llegar el doc en vivo).
 * hastaFirestore = servidor_ts − timestamp (disponible también en historial).
 * Si alguna etapa da negativa hay desfase de reloj entre máquinas.
 */
export function calcularLatencia(doc, llegadaMs = null, cfg = LATENCIA) {
  if (!doc) return null;
  const generado = tsMs(doc.timestamp);
  const enviado = tsMs(doc.enviado_ts);
  const recibido = tsMs(doc.recibido_ts);
  const servidor = tsMs(doc.servidor_ts);
  const llegada = num(llegadaMs);
  const guardadas = doc.latencia_ms || {};

  const dif = (a, b) => (a != null && b != null ? a - b : null);
  const etapas = {
    cola: num(guardadas.cola) ?? dif(enviado, generado),
    red: num(guardadas.red) ?? dif(recibido, enviado),
    escritura: dif(servidor, recibido),
    entrega: dif(llegada, servidor),
  };
  const total = dif(llegada, generado);
  const hastaPuente = num(guardadas.hasta_puente) ?? dif(recibido, generado);
  const hastaFirestore = dif(servidor, generado);

  const valores = [...Object.values(etapas), total, hastaPuente, hastaFirestore].filter((v) => v != null);
  if (valores.length === 0) return null;

  return {
    ...etapas,
    total,
    hastaPuente,
    hastaFirestore,
    // La mejor estimación extremo a extremo disponible para esta lectura
    mejor: total ?? hastaFirestore ?? hastaPuente,
    reenviado: !!doc.reenviado_offline,
    desfase: valores.some((v) => v < -cfg.toleranciaDesfaseMs),
  };
}

export function nivelLatencia(ms, cfg = LATENCIA) {
  if (ms == null) return "desconocido";
  if (ms >= cfg.criticaMs) return "critica";
  if (ms >= cfg.advertenciaMs) return "advertencia";
  return "normal";
}

// ── Estadística ───────────────────────────────────────────────
export function percentil(valores, p) {
  const v = valores.filter((x) => num(x) != null).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const idx = (p / 100) * (v.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return v[lo] + (v[hi] - v[lo]) * (idx - lo);
}

export function estadisticas(valores) {
  const v = valores.filter((x) => num(x) != null);
  if (v.length === 0) return { n: 0, min: null, max: null, prom: null, p95: null };
  let min = Infinity, max = -Infinity, suma = 0;
  for (const x of v) {
    if (x < min) min = x;
    if (x > max) max = x;
    suma += x;
  }
  return { n: v.length, min, max, prom: suma / v.length, p95: percentil(v, 95) };
}

// ── Conectividad ──────────────────────────────────────────────
export function umbralOfflineS(intervaloS, cfg = CONECTIVIDAD) {
  const i = num(intervaloS) && intervaloS > 0 ? intervaloS : cfg.intervaloDefaultS;
  return Math.max(cfg.offlineFactor * i, cfg.offlineMinS);
}

export function umbralRetrasoS(intervaloS, cfg = CONECTIVIDAD) {
  const i = num(intervaloS) && intervaloS > 0 ? intervaloS : cfg.intervaloDefaultS;
  return Math.min(Math.max(cfg.retrasoFactor * i, i + 2), umbralOfflineS(i, cfg));
}

/** Estado según cuánto hace que no llegan datos: online / retrasado / offline / sin-datos. */
export function estadoConectividad(ultimoVistoMs, intervaloS, ahoraMs, cfg = CONECTIVIDAD) {
  const umbralS = umbralOfflineS(intervaloS, cfg);
  if (ultimoVistoMs == null) return { estado: "sin-datos", silencioS: null, umbralS };
  const silencioS = Math.max(0, (ahoraMs - ultimoVistoMs) / 1000);
  let estado = "online";
  if (silencioS > umbralS) estado = "offline";
  else if (silencioS > umbralRetrasoS(intervaloS, cfg)) estado = "retrasado";
  return { estado, silencioS, umbralS };
}

/** Mejor estimación (reloj del navegador) de cuándo llegó una lectura. */
export function vistoMs(doc, llegadaMs) {
  return num(llegadaMs) ?? tsMs(doc?.servidor_ts) ?? tsMs(doc?.recibido_ts) ?? tsMs(doc?.timestamp);
}

// ── Historial ─────────────────────────────────────────────────
/** Huecos entre lecturas (orden ascendente) mayores a umbralS.
 *  Si se pasan desdeMs/hastaMs también cuenta los bordes del rango. */
export function detectarHuecos(lecturas, umbralS, desdeMs = null, hastaMs = null) {
  const huecos = [];
  const umbralMs = umbralS * 1000;
  const tiempos = lecturas.map((l) => tsMs(l.timestamp)).filter((t) => t != null);
  const push = (a, b) => b - a > umbralMs && huecos.push({ desdeMs: a, hastaMs: b, duracionS: (b - a) / 1000 });

  if (tiempos.length === 0) {
    if (desdeMs != null && hastaMs != null) push(desdeMs, hastaMs);
    return huecos;
  }
  if (desdeMs != null) push(desdeMs, tiempos[0]);
  for (let i = 1; i < tiempos.length; i++) push(tiempos[i - 1], tiempos[i]);
  if (hastaMs != null) push(tiempos[tiempos.length - 1], hastaMs);
  return huecos;
}

/** Energía (kWh) por integración trapezoidal, ignorando tramos > maxDtS (huecos). */
export function energiaKWh(lecturas, maxDtS) {
  let wh = 0;
  for (let i = 1; i < lecturas.length; i++) {
    const t0 = tsMs(lecturas[i - 1].timestamp);
    const t1 = tsMs(lecturas[i].timestamp);
    const p0 = num(lecturas[i - 1].medicion?.consumo_w);
    const p1 = num(lecturas[i].medicion?.consumo_w);
    if (t0 == null || t1 == null || p0 == null || p1 == null) continue;
    const dtS = (t1 - t0) / 1000;
    if (dtS <= 0 || dtS > maxDtS) continue;
    wh += ((p0 + p1) / 2) * (dtS / 3600);
  }
  return wh / 1000;
}

/** % del rango [desdeMs, hastaMs] con datos (100 − huecos). */
export function disponibilidad(huecos, desdeMs, hastaMs) {
  const rango = hastaMs - desdeMs;
  if (!(rango > 0)) return null;
  const sinDatos = huecos.reduce((s, h) => {
    const a = Math.max(h.desdeMs, desdeMs);
    const b = Math.min(h.hastaMs, hastaMs);
    return s + Math.max(0, b - a);
  }, 0);
  return Math.max(0, Math.min(100, 100 * (1 - sinDatos / rango)));
}

/** Largest-Triangle-Three-Buckets: reduce a `max` puntos preservando la
 *  forma de la serie `clave` (picos incluidos). Puntos con valor null se descartan. */
export function reducirLTTB(puntos, max, clave, claveX = "t") {
  const datos = puntos.filter((p) => num(p[clave]) != null && num(p[claveX]) != null);
  if (max >= datos.length || max < 3) return datos;
  const out = [datos[0]];
  const tam = (datos.length - 2) / (max - 2);
  let a = 0;
  for (let i = 0; i < max - 2; i++) {
    const iniSig = Math.floor((i + 1) * tam) + 1;
    const finSig = Math.min(Math.floor((i + 2) * tam) + 1, datos.length);
    let promX = 0, promY = 0;
    for (let j = iniSig; j < finSig; j++) { promX += datos[j][claveX]; promY += datos[j][clave]; }
    const cant = Math.max(1, finSig - iniSig);
    promX /= cant; promY /= cant;

    const ini = Math.floor(i * tam) + 1;
    const fin = Math.floor((i + 1) * tam) + 1;
    let maxArea = -1, elegido = ini;
    for (let j = ini; j < fin; j++) {
      const area = Math.abs(
        (datos[a][claveX] - promX) * (datos[j][clave] - datos[a][clave]) -
        (datos[a][claveX] - datos[j][claveX]) * (promY - datos[a][clave])
      );
      if (area > maxArea) { maxArea = area; elegido = j; }
    }
    out.push(datos[elegido]);
    a = elegido;
  }
  out.push(datos[datos.length - 1]);
  return out;
}

/** Inserta puntos nulos en los huecos para que los gráficos corten la línea. */
export function cortarEnHuecos(puntos, umbralS, claveX = "t") {
  const out = [];
  for (let i = 0; i < puntos.length; i++) {
    if (i > 0 && puntos[i][claveX] - puntos[i - 1][claveX] > umbralS * 1000) {
      out.push({ [claveX]: puntos[i - 1][claveX] + 1, hueco: true });
    }
    out.push(puntos[i]);
  }
  return out;
}

export function contarPorTipo(items, campo = "tipo") {
  const c = {};
  for (const it of items) {
    const k = it?.[campo];
    if (k) c[k] = (c[k] || 0) + 1;
  }
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
}

// ── CSV ───────────────────────────────────────────────────────
const COLUMNAS_CSV = [
  ["timestamp", (d) => d.timestamp],
  ["casa_id", (d) => d.casa_id],
  ["nombre", (d) => d.nombre],
  ["tension_v", (d) => d.medicion?.tension_v],
  ["consumo_w", (d) => d.medicion?.consumo_w],
  ["corriente_a", (d) => d.medicion?.corriente_a],
  ["factor_potencia", (d) => d.medicion?.factor_potencia],
  ["potencia_aparente_va", (d) => d.medicion?.potencia_aparente_va],
  ["potencia_reactiva_var", (d) => d.medicion?.potencia_reactiva_var],
  ["frecuencia_hz", (d) => d.medicion?.frecuencia_hz],
  ["evento_red", (d) => d.evento_red],
  ["seq", (d) => d.seq],
  ["latencia_hasta_puente_ms", (d) => calcularLatencia(d)?.hastaPuente],
  ["latencia_hasta_firestore_ms", (d) => calcularLatencia(d)?.hastaFirestore],
  ["anomalias", (d) => detectarAnomalias(d.medicion).map((a) => a.tipo).join("|")],
];

const celdaCSV = (v) => {
  if (v == null) return "";
  const s = typeof v === "number" ? String(Math.round(v * 1000) / 1000) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function aCSV(lecturas) {
  const filas = [COLUMNAS_CSV.map(([h]) => h).join(",")];
  for (const d of lecturas) filas.push(COLUMNAS_CSV.map(([, f]) => celdaCSV(f(d))).join(","));
  return filas.join("\r\n");
}
