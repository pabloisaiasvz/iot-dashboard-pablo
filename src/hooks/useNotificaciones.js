import { useCallback, useEffect, useRef, useState } from "react";
import { NOTIFICACIONES } from "../config";
import {
  agregarNotificacion, contarNoLeidas, eliminarNotificacion, marcarLeida, marcarTodasLeidas,
  PESO_SEVERIDAD, sanearGuardadas,
} from "../utils/notificaciones";

// localStorage puede no existir o tirar excepción (modo privado, cuota llena)
function leer(clave, porDefecto) {
  try {
    const raw = window.localStorage.getItem(clave);
    return raw ? JSON.parse(raw) : porDefecto;
  } catch {
    return porDefecto;
  }
}
function escribir(clave, valor) {
  try {
    window.localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    /* sin persistencia: no es crítico */
  }
}

export const PREFS_DEFAULT = {
  toasts: true,
  toastMin: "media",   // severidad mínima para mostrar toast
  sonido: false,
  navegador: false,    // Notification API del navegador (solo con la pestaña en segundo plano)
  silenciado: false,   // silencia toasts/sonido/navegador; se siguen registrando en el centro
};

const soportaNavegador = () => typeof window !== "undefined" && "Notification" in window;

/** Beep corto con WebAudio (sin archivos de audio). */
function crearSonido() {
  let ctx = null;
  return {
    desbloquear() {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = ctx || new AC();
        if (ctx.state === "suspended") ctx.resume();
      } catch { /* sin audio */ }
    },
    tocar(severidad) {
      if (!ctx || ctx.state !== "running") return;
      try {
        const frec = severidad === "critica" ? [880, 660] : [660];
        frec.forEach((f, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const t = ctx.currentTime + i * 0.18;
          osc.frequency.value = f;
          osc.type = "sine";
          gain.gain.setValueAtTime(0.0001, t);
          gain.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
          osc.connect(gain).connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.17);
        });
      } catch { /* sin audio */ }
    },
  };
}

export function useNotificaciones() {
  const [items, setItems] = useState(() => sanearGuardadas(leer(NOTIFICACIONES.storageItems, [])));
  const [prefs, setPrefs] = useState(() => ({ ...PREFS_DEFAULT, ...leer(NOTIFICACIONES.storagePrefs, {}) }));
  const [toasts, setToasts] = useState([]);
  const [permiso, setPermiso] = useState(() => (soportaNavegador() ? Notification.permission : "no-soportado"));

  // Refs para que notificar() sea estable y lea siempre el último estado
  const itemsRef = useRef(items);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const sonido = useRef(null);
  if (!sonido.current) sonido.current = crearSonido();
  const timers = useRef(new Map());

  useEffect(() => { escribir(NOTIFICACIONES.storageItems, items); }, [items]);
  useEffect(() => { escribir(NOTIFICACIONES.storagePrefs, prefs); }, [prefs]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  // Sincroniza entre pestañas abiertas del dashboard
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === NOTIFICACIONES.storageItems && e.newValue) {
        try {
          const nuevos = sanearGuardadas(JSON.parse(e.newValue));
          itemsRef.current = nuevos;
          setItems(nuevos);
        } catch { /* ignorar */ }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const actualizar = useCallback((fn) => {
    itemsRef.current = fn(itemsRef.current);
    setItems(itemsRef.current);
  }, []);

  const cerrarToast = useCallback((toastId) => {
    clearTimeout(timers.current.get(toastId));
    timers.current.delete(toastId);
    setToasts((ts) => ts.filter((t) => t.toastId !== toastId));
  }, []);

  const mostrarToast = useCallback((n) => {
    const toastId = `${n.id}:${n.count}`;
    setToasts((ts) => {
      // Una notificación agrupada reemplaza a su toast anterior
      const resto = ts.filter((t) => t.id !== n.id);
      return [{ ...n, toastId }, ...resto].slice(0, NOTIFICACIONES.maxToasts);
    });
    const dur = n.severidad === "critica" ? NOTIFICACIONES.toastCriticoMs : NOTIFICACIONES.toastMs;
    timers.current.set(toastId, setTimeout(() => cerrarToast(toastId), dur));
  }, [cerrarToast]);

  const notificar = useCallback((entradas) => {
    const lista = Array.isArray(entradas) ? entradas : [entradas];
    const ahora = Date.now();
    const p = prefsRef.current;
    let actual = itemsRef.current;
    for (const entrada of lista) {
      const { items: siguientes, notificacion, agrupada } = agregarNotificacion(actual, entrada, ahora);
      actual = siguientes;
      if (p.silenciado) continue;

      const peso = PESO_SEVERIDAD[notificacion.severidad];
      const importante = peso >= PESO_SEVERIDAD[p.toastMin] || notificacion.severidad === "ok";
      if (p.toasts && importante) mostrarToast(notificacion);
      if (!agrupada && p.sonido && peso >= PESO_SEVERIDAD.alta) sonido.current.tocar(notificacion.severidad);
      if (!agrupada && p.navegador && peso >= PESO_SEVERIDAD.alta && soportaNavegador()
          && Notification.permission === "granted" && document.hidden) {
        try {
          new Notification(notificacion.titulo, { body: notificacion.mensaje, tag: notificacion.clave || notificacion.id });
        } catch { /* algunos navegadores móviles no permiten el constructor */ }
      }
    }
    itemsRef.current = actual;
    setItems(actual);
  }, [mostrarToast]);

  const cambiarPref = useCallback(async (clave, valor) => {
    if (clave === "sonido" && valor) sonido.current.desbloquear(); // requiere gesto del usuario
    if (clave === "navegador" && valor && soportaNavegador() && Notification.permission !== "granted") {
      try {
        const r = await Notification.requestPermission();
        setPermiso(r);
        if (r !== "granted") return;
      } catch {
        return;
      }
    }
    setPrefs((pr) => ({ ...pr, [clave]: valor }));
  }, []);

  return {
    items,
    noLeidas: contarNoLeidas(items),
    toasts,
    prefs,
    permisoNavegador: permiso,
    notificar,
    cerrarToast,
    cambiarPref,
    marcarLeida: useCallback((id) => actualizar((it) => marcarLeida(it, id)), [actualizar]),
    marcarTodasLeidas: useCallback(() => actualizar(marcarTodasLeidas), [actualizar]),
    eliminar: useCallback((id) => actualizar((it) => eliminarNotificacion(it, id)), [actualizar]),
    limpiar: useCallback(() => actualizar(() => []), [actualizar]),
  };
}
