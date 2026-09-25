// ── Motor de notificaciones ───────────────────────────────────
// Decide QUÉ notificar comparando el estado actual con el anterior.
// `motor` es un objeto mutable (vive en un useRef); las funciones devuelven
// la lista de notificaciones a emitir. Sin React: se testea aparte.
import { LATENCIA, NOTIFICACIONES } from "../config";
import { calcularLatencia, detectarAnomalias, tsMs } from "./telemetria";
import { severidadDesdeAlerta } from "./notificaciones";
import { fmtDuracion, fmtMs } from "./formato";

const PUENTE_CAIDO = ["caido", "detenido", "sin-broker"];
const SIMULADOR_TOLERANCIA_S = 95; // heartbeat del simulador cada 30 s

export const TIPOS_ANOMALIA = {
  BAJA_TENSION: "Baja tensión",
  SOBRETENSION: "Sobretensión",
  PICO_CONSUMO: "Pico de consumo",
  FACTOR_POTENCIA_BAJO: "Factor de potencia bajo",
  FRECUENCIA_ANORMAL: "Frecuencia anormal",
};

export const crearMotor = () => ({
  iniciado: false,
  conectividad: {},   // casa_id → último estado visto
  offlineDesde: {},   // casa_id → ms en que se lo dejó de ver
  suprimidos: {},     // casa_id → true si su offline no se notificó (puente caído)
  puente: null,
  firestore: null,
  simulador: null,
  eventoRed: null,
  eventoRedVistoMs: 0,
  latAltas: {},       // casa_id → lecturas consecutivas con latencia crítica
});

export function estadoSimulador(doc, ahoraMs) {
  if (!doc) return "desconocido";
  if (doc.estado === "offline") return doc.evento === "SIMULADOR_DESCONECTADO" ? "desconectado" : "detenido";
  const visto = tsMs(doc.actualizado) ?? tsMs(doc.recibido_ts);
  if (visto != null && (ahoraMs - visto) / 1000 > SIMULADOR_TOLERANCIA_S) return "sin-heartbeat";
  return "online";
}

const etiqueta = (d) => (d.nombre && d.nombre !== d.casa_id ? `${d.nombre} (${d.casa_id})` : d.casa_id);

/**
 * Evaluación periódica (cada segundo): conectividad de cada dispositivo,
 * puente, Firestore, simulador y fin de eventos de red.
 */
export function evaluarEstado(motor, { dispositivos, puente, firestoreOnline, simulador, ahora }) {
  const notifs = [];
  const puenteEstado = puente?.estado || "desconocido";
  const puenteCaido = PUENTE_CAIDO.includes(puenteEstado);
  const simEstado = estadoSimulador(simulador, ahora);
  // Si se cayó la infraestructura, todos los dispositivos "parecen" offline:
  // se notifica la causa una sola vez en vez de N alertas por dispositivo.
  const infraCaida = puenteCaido || firestoreOnline === false;

  if (!motor.iniciado) {
    motor.iniciado = true;
    const offline = [];
    for (const d of dispositivos) {
      const e = d.conectividad?.estado;
      motor.conectividad[d.casa_id] = e;
      if (e === "offline") {
        offline.push(d.casa_id);
        motor.offlineDesde[d.casa_id] = d.ultimoVistoMs ?? ahora;
        if (infraCaida) motor.suprimidos[d.casa_id] = true;
      }
    }
    motor.puente = puenteEstado;
    motor.firestore = firestoreOnline;
    motor.simulador = simEstado;
    if (offline.length && !infraCaida) {
      notifs.push({
        clave: "inicio:offline", tipo: "conectividad", severidad: "media",
        titulo: `${offline.length} dispositivo(s) sin datos`,
        mensaje: `Al abrir el dashboard: ${offline.join(", ")}`,
      });
    }
    if (puenteCaido) notifs.push(notifPuente(puenteEstado, puente));
    return notifs;
  }

  // ── Infraestructura ───────────────────────────────────────
  if (firestoreOnline !== motor.firestore) {
    if (firestoreOnline === false) {
      notifs.push({ clave: "firestore", tipo: "sistema", severidad: "critica",
        titulo: "Sin conexión con Firestore",
        mensaje: "Mostrando datos en caché. Se reconecta automáticamente." });
    } else if (motor.firestore === false) {
      notifs.push({ clave: "firestore", tipo: "sistema", severidad: "ok",
        titulo: "Conexión con Firestore restablecida", mensaje: "Datos en vivo nuevamente." });
    }
    motor.firestore = firestoreOnline;
  }

  if (puenteEstado !== motor.puente) {
    if (puenteCaido) notifs.push(notifPuente(puenteEstado, puente));
    else if (puenteEstado === "online" && PUENTE_CAIDO.includes(motor.puente)) {
      notifs.push({ clave: "puente", tipo: "sistema", severidad: "ok",
        titulo: "Puente MQTT → Firestore restablecido", mensaje: "Vuelven a llegar datos del broker." });
    }
    motor.puente = puenteEstado;
  }

  if (simEstado !== motor.simulador) {
    const prev = motor.simulador;
    if (simEstado === "desconectado") {
      notifs.push({ clave: "simulador", tipo: "sistema", severidad: "alta",
        titulo: "Simulador desconectado", mensaje: "El broker publicó su Last Will: el proceso se cortó sin avisar." });
    } else if (simEstado === "detenido") {
      notifs.push({ clave: "simulador", tipo: "sistema", severidad: "media",
        titulo: "Simulador detenido", mensaje: "Se detuvo de forma ordenada (Ctrl+C)." });
    } else if (simEstado === "sin-heartbeat" && !infraCaida) {
      notifs.push({ clave: "simulador", tipo: "sistema", severidad: "alta",
        titulo: "Simulador sin heartbeat", mensaje: `No se recibe su estado hace más de ${SIMULADOR_TOLERANCIA_S}s.` });
    } else if (simEstado === "online" && prev && prev !== "desconocido") {
      notifs.push({ clave: "simulador", tipo: "sistema", severidad: "ok",
        titulo: "Simulador en línea", mensaje: "El simulador volvió a publicar." });
    }
    motor.simulador = simEstado;
  }

  // ── Dispositivos ──────────────────────────────────────────
  for (const d of dispositivos) {
    const id = d.casa_id;
    const actual = d.conectividad?.estado;
    const previo = motor.conectividad[id];
    if (actual === previo) continue;
    motor.conectividad[id] = actual;

    if (actual === "offline") {
      motor.offlineDesde[id] = d.ultimoVistoMs ?? ahora;
      if (infraCaida) {
        motor.suprimidos[id] = true;
        continue;
      }
      if (previo === undefined) continue; // apareció ya offline (registro viejo)
      notifs.push({
        clave: `offline:${id}`, tipo: "conectividad", severidad: "alta", casa_id: id,
        titulo: `${etiqueta(d)} OFFLINE`,
        mensaje: `Sin datos hace ${fmtDuracion(d.conectividad.silencioS)} (umbral ${fmtDuracion(d.conectividad.umbralS)}).`,
      });
    } else if ((actual === "online" || actual === "retrasado") && previo === "offline") {
      const suprimido = motor.suprimidos[id];
      delete motor.suprimidos[id];
      const desde = motor.offlineDesde[id];
      delete motor.offlineDesde[id];
      if (suprimido) continue;
      const dur = desde != null && d.ultimoVistoMs != null ? (d.ultimoVistoMs - desde) / 1000 : null;
      notifs.push({
        clave: `online:${id}`, tipo: "conectividad", severidad: "ok", casa_id: id,
        titulo: `${etiqueta(d)} volvió a estar ONLINE`,
        mensaje: dur != null ? `Estuvo ${fmtDuracion(dur)} sin reportar.` : "Vuelve a reportar datos.",
      });
    } else if (previo === undefined && actual === "online") {
      notifs.push({
        clave: `nuevo:${id}`, tipo: "conectividad", severidad: "info", casa_id: id,
        titulo: "Nuevo dispositivo", mensaje: `${etiqueta(d)} empezó a reportar.`,
      });
    }
  }

  // ── Fin de evento de red ──────────────────────────────────
  if (motor.eventoRed && ahora - motor.eventoRedVistoMs > NOTIFICACIONES.finEventoRedMs) {
    notifs.push({
      clave: `red-fin:${motor.eventoRed}`, tipo: "red", severidad: "ok",
      titulo: "Evento de red finalizado",
      mensaje: `La red volvió a valores normales (${motor.eventoRed.replace(/_/g, " ")}).`,
    });
    motor.eventoRed = null;
  }

  return notifs;
}

function notifPuente(estado, puente) {
  const edad = puente?.edadS != null ? ` (último heartbeat hace ${fmtDuracion(puente.edadS)})` : "";
  const textos = {
    caido: ["Puente MQTT → Firestore caído", `No se actualiza sistema/puente${edad}. Los dispositivos aparecerán offline.`],
    detenido: ["Puente MQTT → Firestore detenido", "El puente se apagó: no se guardan datos nuevos."],
    "sin-broker": ["Puente sin conexión al broker", "El puente está vivo pero perdió la conexión MQTT."],
  };
  const [titulo, mensaje] = textos[estado];
  return { clave: "puente", tipo: "sistema", severidad: estado === "sin-broker" ? "alta" : "critica", titulo, mensaje };
}

/** Evaluación de cada lectura que llega en vivo. */
export function evaluarLectura(motor, doc, ahora, cfgLat = LATENCIA) {
  const notifs = [];
  const id = doc.casa_id;
  const nombre = doc.nombre ? `${doc.nombre}` : id;

  for (const a of detectarAnomalias(doc.medicion)) {
    notifs.push({
      clave: `anomalia:${id}:${a.tipo}`, tipo: "anomalia", casa_id: id,
      severidad: severidadDesdeAlerta(a.severidad),
      titulo: `${nombre}: ${TIPOS_ANOMALIA[a.tipo] || a.tipo}`,
      mensaje: a.descripcion,
    });
  }

  if (doc.evento_red) {
    motor.eventoRedVistoMs = ahora;
    if (motor.eventoRed !== doc.evento_red) {
      motor.eventoRed = doc.evento_red;
      notifs.push({
        clave: `red:${doc.evento_red}`, tipo: "red", severidad: "critica",
        cooldownMs: NOTIFICACIONES.cooldownRedMs,
        titulo: `Evento de red: ${doc.evento_red.replace(/_/g, " ").toUpperCase()}`,
        mensaje: "Afecta a todos los dispositivos de la red al mismo tiempo.",
      });
    }
  }

  const lat = calcularLatencia(doc, doc._llegadaMs, cfgLat);
  if (lat && !lat.reenviado && lat.mejor != null) {
    if (lat.mejor >= cfgLat.criticaMs) {
      motor.latAltas[id] = (motor.latAltas[id] || 0) + 1;
      if (motor.latAltas[id] === cfgLat.lecturasConsecutivas) {
        notifs.push({
          clave: `latencia:${id}`, tipo: "latencia", severidad: "alta", casa_id: id,
          cooldownMs: NOTIFICACIONES.cooldownLatenciaMs,
          titulo: `${nombre}: latencia alta`,
          mensaje: `${fmtMs(lat.mejor)} extremo a extremo (${cfgLat.lecturasConsecutivas} lecturas seguidas > ${fmtMs(cfgLat.criticaMs)}).`,
        });
      }
    } else {
      motor.latAltas[id] = 0;
    }
  }

  if (doc.perdidos_previos > 0) {
    notifs.push({
      clave: `perdidos:${id}`, tipo: "conectividad", severidad: "media", casa_id: id,
      titulo: `${nombre}: mensajes perdidos`,
      mensaje: `${doc.perdidos_previos} mensaje(s) no llegaron (hueco en la secuencia antes de #${doc.seq}).`,
    });
  }

  if (doc.reenviado_offline) {
    notifs.push({
      clave: `cola:${id}`, tipo: "conectividad", severidad: "info", casa_id: id,
      titulo: `${nombre}: datos atrasados`,
      mensaje: "Llegan lecturas que esperaron en la cola offline del simulador.",
    });
  }

  return notifs;
}
