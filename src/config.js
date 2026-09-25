// ── Configuración central del dashboard ──────────────────────
// Los umbrales eléctricos son los mismos que usa el simulador (env.example).

export const UMBRALES = {
  tensionMin: 195,
  tensionMax: 245,
  tensionBajaCritica: 185,
  tensionAltaCritica: 255,
  tensionWarn: 240,
  consumoMax: 4500,
  consumoWarn: 3500,
  consumoCritico: 4500 * 1.3,
  fpMin: 0.75,
  frecuenciaMin: 48.5,
  frecuenciaMax: 51.5,
};

// Un dispositivo pasa a OFFLINE si no manda datos en
// max(offlineFactor × intervalo, offlineMinS). Si el puente publica sus
// propios valores (sistema/puente) se usan esos para que ambos coincidan.
export const CONECTIVIDAD = {
  intervaloDefaultS: 5,
  offlineFactor: 3,
  offlineMinS: 15,
  retrasoFactor: 2,      // más de 2 intervalos sin datos = "retrasado"
  puenteToleranciaS: 45, // heartbeat del puente más viejo que esto = puente caído
};

export const LATENCIA = {
  advertenciaMs: 2000,
  criticaMs: 5000,
  lecturasConsecutivas: 3, // lecturas seguidas sobre el umbral crítico para notificar
  ventana: 30,             // lecturas usadas para promedio / p95
  toleranciaDesfaseMs: 50, // etapas negativas menores a esto se consideran ruido
};

export const EN_VIVO = {
  limiteLecturas: 200,
  lecturasGrafico: 30,
  filasTabla: 12,
};

export const HISTORIAL = {
  rangos: [
    { id: "15m", etiqueta: "15 MIN", ms: 15 * 60e3 },
    { id: "1h", etiqueta: "1 H", ms: 60 * 60e3 },
    { id: "6h", etiqueta: "6 H", ms: 6 * 60 * 60e3 },
    { id: "24h", etiqueta: "24 H", ms: 24 * 60 * 60e3 },
    { id: "7d", etiqueta: "7 DÍAS", ms: 7 * 24 * 60 * 60e3 },
  ],
  rangoDefault: "1h",
  limites: [250, 500, 1000, 2000],
  limiteDefault: 1000,
  limiteEventos: 300,
  puntosGrafico: 300,
  filasPorPagina: 25,
  maxAreasHuecos: 60,
};

export const NOTIFICACIONES = {
  max: 200,
  cooldownMs: 60e3,          // misma clave dentro de este lapso → se agrupa (×N)
  cooldownLatenciaMs: 5 * 60e3,
  cooldownRedMs: 5 * 60e3,
  toastMs: 6000,
  toastCriticoMs: 12000,
  maxToasts: 4,
  finEventoRedMs: 20e3,      // sin lecturas con evento_red durante esto = evento terminado
  storageItems: "iot-dashboard:notificaciones:v1",
  storagePrefs: "iot-dashboard:notificaciones-prefs:v1",
};
