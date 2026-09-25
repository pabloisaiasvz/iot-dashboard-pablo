import { useEffect, useRef, useState } from "react";
import { filtrarNotificaciones } from "../utils/notificaciones";
import { fmtHace } from "../utils/formato";

const ICONOS = { critica: "⛔", alta: "⚠", media: "▲", info: "ℹ", ok: "✓" };

const FILTROS = [
  ["todas", "TODAS"],
  ["no-leidas", "NO LEÍDAS"],
  ["criticas", "CRÍTICAS"],
  ["conectividad", "CONECTIVIDAD"],
  ["anomalias", "ANOMALÍAS"],
];

function ItemNotificacion({ n, ahora, onClick, onEliminar }) {
  return (
    <li className={`notif-item sev-${n.severidad} ${n.leida ? "leida" : ""}`}>
      <button type="button" className="notif-item-main" onClick={() => onClick(n)}>
        <span className="notif-icono" aria-hidden>{ICONOS[n.severidad]}</span>
        <span className="notif-cuerpo">
          <span className="notif-titulo">
            {n.titulo}
            {n.count > 1 && <span className="notif-count">×{n.count}</span>}
          </span>
          {n.mensaje && <span className="notif-mensaje">{n.mensaje}</span>}
          <span className="notif-hora" title={new Date(n.ultimoTs).toLocaleString("es-AR")}>
            {fmtHace(n.ultimoTs, ahora)}
          </span>
        </span>
      </button>
      <button type="button" className="notif-eliminar" onClick={() => onEliminar(n.id)} aria-label="Eliminar notificación">×</button>
    </li>
  );
}

function Interruptor({ label, activo, onChange, deshabilitado, ayuda }) {
  return (
    <label className={`notif-pref ${deshabilitado ? "deshabilitado" : ""}`} title={ayuda}>
      <input type="checkbox" checked={!!activo} disabled={deshabilitado} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Campana del header + panel desplegable con el centro de notificaciones. */
export function CentroNotificaciones({ notif, ahora, onSeleccionarDispositivo }) {
  const [abierto, setAbierto] = useState(false);
  const [filtro, setFiltro] = useState("todas");
  const [verPrefs, setVerPrefs] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e) => { if (ref.current && !ref.current.contains(e.target)) setAbierto(false); };
    const esc = (e) => { if (e.key === "Escape") setAbierto(false); };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [abierto]);

  const visibles = filtrarNotificaciones(notif.items, filtro);
  const { prefs, permisoNavegador } = notif;

  const abrir = (n) => {
    notif.marcarLeida(n.id);
    if (n.casa_id) {
      onSeleccionarDispositivo(n.casa_id);
      setAbierto(false);
    }
  };

  return (
    <div className="notif-centro" ref={ref}>
      <button
        type="button"
        className={`notif-campana ${notif.noLeidas ? "con-pendientes" : ""}`}
        onClick={() => setAbierto((a) => !a)}
        aria-label={`Notificaciones (${notif.noLeidas} sin leer)`}
        aria-expanded={abierto}
      >
        <span aria-hidden>{prefs.silenciado ? "🔕" : "🔔"}</span>
        {notif.noLeidas > 0 && <span className="notif-contador">{notif.noLeidas > 99 ? "99+" : notif.noLeidas}</span>}
      </button>

      {abierto && (
        <div className="notif-panel" role="dialog" aria-label="Centro de notificaciones">
          <div className="notif-panel-header">
            <span className="notif-panel-titulo">NOTIFICACIONES</span>
            <div className="notif-acciones">
              <button type="button" onClick={notif.marcarTodasLeidas} disabled={!notif.noLeidas}>Marcar leídas</button>
              <button type="button" onClick={notif.limpiar} disabled={!notif.items.length}>Limpiar</button>
              <button type="button" onClick={() => setVerPrefs((v) => !v)} aria-expanded={verPrefs}>⚙</button>
            </div>
          </div>

          {verPrefs && (
            <div className="notif-prefs">
              <Interruptor label="Silenciar todo" activo={prefs.silenciado} onChange={(v) => notif.cambiarPref("silenciado", v)}
                ayuda="Se siguen registrando acá, pero sin avisos emergentes ni sonido" />
              <Interruptor label="Avisos emergentes" activo={prefs.toasts} onChange={(v) => notif.cambiarPref("toasts", v)} />
              <label className="notif-pref">
                <span>Mínimo para avisos</span>
                <select value={prefs.toastMin} onChange={(e) => notif.cambiarPref("toastMin", e.target.value)}>
                  <option value="critica">Crítica</option>
                  <option value="alta">Alta</option>
                  <option value="media">Media</option>
                  <option value="info">Todas</option>
                </select>
              </label>
              <Interruptor label="Sonido (alta/crítica)" activo={prefs.sonido} onChange={(v) => notif.cambiarPref("sonido", v)} />
              <Interruptor
                label={`Notificaciones del navegador${permisoNavegador === "denied" ? " (bloqueadas)" : ""}`}
                activo={prefs.navegador && permisoNavegador === "granted"}
                deshabilitado={permisoNavegador === "no-soportado" || permisoNavegador === "denied"}
                onChange={(v) => notif.cambiarPref("navegador", v)}
                ayuda="Se muestran solo cuando la pestaña está en segundo plano"
              />
            </div>
          )}

          <div className="notif-filtros">
            {FILTROS.map(([id, txt]) => (
              <button key={id} type="button" className={filtro === id ? "activo" : ""} onClick={() => setFiltro(id)}>{txt}</button>
            ))}
          </div>

          {visibles.length === 0 ? (
            <div className="notif-vacio">Sin notificaciones</div>
          ) : (
            <ul className="notif-lista">
              {visibles.map((n) => (
                <ItemNotificacion key={n.id} n={n} ahora={ahora} onClick={abrir} onEliminar={notif.eliminar} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Avisos emergentes (abajo a la derecha). */
export function Toasts({ toasts, onCerrar, onSeleccionarDispositivo }) {
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.toastId} className={`toast sev-${t.severidad}`}>
          <span className="notif-icono" aria-hidden>{ICONOS[t.severidad]}</span>
          <button
            type="button"
            className="toast-cuerpo"
            onClick={() => { if (t.casa_id) onSeleccionarDispositivo(t.casa_id); onCerrar(t.toastId); }}
          >
            <span className="notif-titulo">
              {t.titulo}
              {t.count > 1 && <span className="notif-count">×{t.count}</span>}
            </span>
            {t.mensaje && <span className="notif-mensaje">{t.mensaje}</span>}
          </button>
          <button type="button" className="notif-eliminar" onClick={() => onCerrar(t.toastId)} aria-label="Cerrar aviso">×</button>
        </div>
      ))}
    </div>
  );
}
