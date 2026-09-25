import { useEffect, useRef, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";

/**
 * Lecturas de telemetría en vivo.
 *
 * Además de los datos, registra la hora a la que cada documento NUEVO llegó
 * al navegador (`_llegadaMs`), que es la última etapa de la latencia. Los
 * documentos de la carga inicial no la tienen (no sabemos cuándo llegaron).
 *
 * `onNuevas(docs)` se llama solo con lecturas que llegaron en vivo, nunca con
 * la carga inicial, para no disparar notificaciones de datos viejos.
 */
export function useTelemetriaEnVivo(limite, onNuevas) {
  const [estado, setEstado] = useState({ docs: [], cargando: true, error: null, desdeCache: false });
  const llegadas = useRef(new Map());
  const callback = useRef(onNuevas);
  callback.current = onNuevas;

  useEffect(() => {
    let primeraDelServidor = true;
    const q = query(collection(db, "telemetria"), orderBy("timestamp", "desc"), limit(limite));

    const unsub = onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
      const ahora = Date.now();
      const desdeCache = snap.metadata.fromCache;
      const nuevas = [];

      if (!desdeCache) {
        if (primeraDelServidor) {
          primeraDelServidor = false;
        } else {
          for (const ch of snap.docChanges()) {
            if (ch.type === "added" && !llegadas.current.has(ch.doc.id)) {
              llegadas.current.set(ch.doc.id, ahora);
              nuevas.push({ id: ch.doc.id, ...ch.doc.data(), _llegadaMs: ahora });
            }
          }
        }
      }

      // Limpia horas de llegada de documentos que ya salieron de la ventana
      const vigentes = new Set(snap.docs.map((d) => d.id));
      for (const id of llegadas.current.keys()) if (!vigentes.has(id)) llegadas.current.delete(id);

      const docs = snap.docs.map((d) => ({ id: d.id, ...d.data(), _llegadaMs: llegadas.current.get(d.id) ?? null }));
      setEstado({ docs, cargando: false, error: null, desdeCache });
      if (nuevas.length && callback.current) callback.current(nuevas);
    }, (err) => {
      setEstado((s) => ({ ...s, cargando: false, error: err }));
    });
    return () => unsub();
  }, [limite]);

  return estado;
}

/** Colección completa o consulta en vivo. `crearQuery` debe ser estable (useCallback/constante). */
export function useColeccion(crearQuery) {
  const [estado, setEstado] = useState({ docs: [], cargando: true, error: null });
  useEffect(() => {
    const unsub = onSnapshot(crearQuery(db), (snap) => {
      setEstado({ docs: snap.docs.map((d) => ({ id: d.id, ...d.data() })), cargando: false, error: null });
    }, (err) => {
      // Sin permisos o sin la colección: el dashboard sigue funcionando sin ella
      console.warn("[firestore] consulta no disponible:", err.code, err.message);
      setEstado({ docs: [], cargando: false, error: err });
    });
    return () => unsub();
  }, [crearQuery]);
  return estado;
}

export function useDocumento(ruta) {
  const [estado, setEstado] = useState({ data: null, cargando: true, error: null });
  useEffect(() => {
    const unsub = onSnapshot(doc(db, ruta), (snap) => {
      setEstado({ data: snap.exists() ? { id: snap.id, ...snap.data() } : null, cargando: false, error: null });
    }, (err) => {
      console.warn(`[firestore] ${ruta} no disponible:`, err.code, err.message);
      setEstado({ data: null, cargando: false, error: err });
    });
    return () => unsub();
  }, [ruta]);
  return estado;
}

// Queries estables para useColeccion
export const qDispositivos = (d) => collection(d, "dispositivos");
