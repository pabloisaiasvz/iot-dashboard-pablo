import { useCallback, useEffect, useRef, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { HISTORIAL } from "../config";

/** Firestore pide un índice compuesto (casa_id + timestamp) para estas
 *  consultas; el mensaje de error trae el link para crearlo con un clic. */
export function describirError(err) {
  if (!err) return null;
  const link = /https:\/\/console\.firebase\.google\.com\S+/.exec(err.message || "")?.[0] || null;
  if (err.code === "failed-precondition") {
    return { tipo: "indice", mensaje: "Falta el índice compuesto de Firestore para esta consulta.", link };
  }
  if (err.code === "permission-denied") {
    return { tipo: "permisos", mensaje: "Las reglas de Firestore no permiten leer esta colección.", link: null };
  }
  return { tipo: "otro", mensaje: err.message || String(err), link };
}

async function consultar(coleccion, casaId, desdeIso, hastaIso, max) {
  const q = query(
    collection(db, coleccion),
    where("casa_id", "==", casaId),
    where("timestamp", ">=", desdeIso),
    where("timestamp", "<=", hastaIso),
    orderBy("timestamp", "desc"),
    limit(max),
  );
  const snap = await getDocs(q);
  // Se piden las más recientes (desc) y se devuelven en orden cronológico
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).reverse();
}

/**
 * Historial de un dispositivo: lecturas, alertas del simulador y eventos de
 * conectividad del puente, en paralelo. Cada parte falla por separado (por
 * ejemplo, si falta un índice de `eventos` las lecturas se muestran igual).
 */
export function useHistorial(casaId, desdeMs, hastaMs, max = HISTORIAL.limiteDefault) {
  const [estado, setEstado] = useState({
    cargando: false, lecturas: [], alertas: [], eventos: [], errores: {}, truncado: false, cargadoMs: null,
  });
  const pedido = useRef(0);

  const cargar = useCallback(async () => {
    if (!casaId || desdeMs == null || hastaMs == null) return;
    const id = ++pedido.current;
    setEstado((s) => ({ ...s, cargando: true }));

    // El simulador guarda timestamp como ISO UTC: la comparación de strings
    // respeta el orden cronológico.
    const desdeIso = new Date(desdeMs).toISOString();
    const hastaIso = new Date(hastaMs).toISOString();
    const [lec, ale, eve] = await Promise.allSettled([
      consultar("telemetria", casaId, desdeIso, hastaIso, max),
      consultar("alertas", casaId, desdeIso, hastaIso, HISTORIAL.limiteEventos),
      consultar("eventos", casaId, desdeIso, hastaIso, HISTORIAL.limiteEventos),
    ]);
    if (id !== pedido.current) return; // llegó una respuesta vieja: la descarto

    const valor = (r) => (r.status === "fulfilled" ? r.value : []);
    const errores = {};
    if (lec.status === "rejected") errores.lecturas = describirError(lec.reason);
    if (ale.status === "rejected") errores.alertas = describirError(ale.reason);
    if (eve.status === "rejected") errores.eventos = describirError(eve.reason);

    setEstado({
      cargando: false,
      lecturas: valor(lec),
      alertas: valor(ale),
      eventos: valor(eve),
      errores,
      truncado: valor(lec).length >= max,
      cargadoMs: Date.now(),
    });
  }, [casaId, desdeMs, hastaMs, max]);

  useEffect(() => { cargar(); }, [cargar]);

  return { ...estado, recargar: cargar };
}
