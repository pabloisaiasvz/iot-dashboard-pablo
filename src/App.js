import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./css/styles.css";
import { EN_VIVO } from "./config";
import { useAhora } from "./hooks/useAhora";
import { qDispositivos, useColeccion, useDocumento, useTelemetriaEnVivo } from "./hooks/useFirestore";
import { useNotificaciones } from "./hooks/useNotificaciones";
import { agruparDispositivos, aplicarConectividad, configConectividad, estadoPuente, resumenFlota } from "./utils/dispositivos";
import { crearMotor, estadoSimulador, evaluarEstado, evaluarLectura } from "./utils/motorNotificaciones";
import { fmtDuracion, fmtHace, fmtMs } from "./utils/formato";
import { tieneAnomalia } from "./utils/telemetria";
import { EstadoBadge, LatenciaChip } from "./components/Indicadores";
import { CentroNotificaciones, Toasts } from "./components/Notificaciones";
import VistaEnVivo from "./components/VistaEnVivo";
import HistorialDispositivo from "./components/HistorialDispositivo";

const TEXTO_PUENTE = {
  online: "ONLINE", "sin-broker": "SIN BROKER", caido: "CAÍDO", detenido: "DETENIDO", desconocido: "—",
};
const TEXTO_SIMULADOR = {
  online: "ONLINE", "sin-heartbeat": "SIN HEARTBEAT", detenido: "DETENIDO", desconectado: "DESCONECTADO", desconocido: "—",
};
const colorEstado = (e) => ({
  online: "var(--color-success)", "sin-broker": "var(--color-warning)", "sin-heartbeat": "var(--color-warning)",
  caido: "var(--color-danger)", detenido: "var(--color-danger)", desconectado: "var(--color-danger)",
}[e] || "var(--text-secondary)");

// ── Main Dashboard ─────────────────────────────────────────────
export default function Dashboard() {
  const [selected, setSelected] = useState(null);
  const [vista, setVista] = useState("vivo");
  const [theme, setTheme] = useState("dark");
  const ahora = useAhora(1000);
  const notif = useNotificaciones();
  const { notificar } = notif;
  const motor = useRef(crearMotor());

  const toggleTheme = () => {
    setTheme(prev => prev === "dark" ? "light" : "dark");
  };

  // Lecturas que llegan en vivo → anomalías, eventos de red, latencia, pérdidas
  const onNuevas = useCallback((docs) => {
    const t = Date.now();
    const salida = docs.flatMap((d) => evaluarLectura(motor.current, d, t));
    if (salida.length) notificar(salida);
  }, [notificar]);

  // Real-time listeners
  const tel = useTelemetriaEnVivo(EN_VIVO.limiteLecturas, onNuevas);
  const registro = useColeccion(qDispositivos);
  const puenteDoc = useDocumento("sistema/puente");
  const simDoc = useDocumento("sistema/simulador");

  const cfgCon = useMemo(() => configConectividad(puenteDoc.data), [puenteDoc.data]);
  const grupos = useMemo(() => agruparDispositivos(tel.docs, registro.docs), [tel.docs, registro.docs]);
  const dispositivos = useMemo(() => aplicarConectividad(grupos, ahora, cfgCon), [grupos, ahora, cfgCon]);
  const puente = useMemo(() => estadoPuente(puenteDoc.data, ahora, cfgCon), [puenteDoc.data, ahora, cfgCon]);
  const simEstado = estadoSimulador(simDoc.data, ahora);
  const firestoreOnline = tel.cargando ? null : !tel.desdeCache;
  const listo = !tel.cargando && !registro.cargando && !puenteDoc.cargando && !simDoc.cargando;

  // Evaluación periódica: transiciones online/offline, puente, Firestore, simulador
  useEffect(() => {
    if (!listo) return;
    const salida = evaluarEstado(motor.current, {
      dispositivos, puente, firestoreOnline, simulador: simDoc.data, ahora,
    });
    if (salida.length) notificar(salida);
  }, [listo, dispositivos, puente, firestoreOnline, simDoc.data, ahora, notificar]);

  const seleccionar = useCallback((casaId) => setSelected(casaId), []);

  if (tel.cargando) return (
    <div className="loading-screen">
      <div className="loading-text">CONECTANDO A FIREBASE...</div>
    </div>
  );

  if (tel.error) return (
    <div className="error-screen">
      <div className="error-title">ERROR DE CONEXIÓN</div>
      <div className="error-msg">{tel.error.message}</div>
    </div>
  );

  const selDispositivo = dispositivos.find((d) => d.casa_id === selected) || dispositivos[0];

  // Global stats
  const flota = resumenFlota(dispositivos);
  const activos = dispositivos.filter((d) => d.conectividad.estado !== "offline" && d.conectividad.estado !== "sin-datos");
  const totalConsumo = activos.reduce((s, d) => s + (d.ultimo?.medicion?.consumo_w || 0), 0);
  const alertCount = tel.docs.filter((d) => tieneAnomalia(d.medicion)).length;
  const latProms = activos.map((d) => d.latencia?.stats?.prom).filter((v) => v != null);
  const latGlobal = latProms.length ? latProms.reduce((a, b) => a + b, 0) / latProms.length : null;

  const infraProblemas = [];
  if (firestoreOnline === false) {
    infraProblemas.push(["danger", "Sin conexión con Firestore: se muestran datos en caché y el estado de los dispositivos no es confiable."]);
  }
  if (["caido", "detenido", "sin-broker"].includes(puente.estado)) {
    const txt = {
      caido: `Puente MQTT → Firestore caído (último heartbeat ${fmtHace(ahora - (puente.edadS ?? 0) * 1000, ahora)}). No se guardan datos nuevos: los dispositivos figurarán offline.`,
      detenido: "El puente MQTT → Firestore está detenido. Ejecutá subscriber_firebase.py para volver a recibir datos.",
      "sin-broker": "El puente está activo pero sin conexión al broker MQTT; reintenta automáticamente.",
    }[puente.estado];
    infraProblemas.push([puente.estado === "sin-broker" ? "warning" : "danger", txt]);
  }
  const sinPermisos = [registro.error, puenteDoc.error, simDoc.error].some((e) => e?.code === "permission-denied");
  if (sinPermisos) {
    infraProblemas.push(["warning", "Las reglas de Firestore no permiten leer dispositivos/ o sistema/: la detección offline funciona solo con la ventana en vivo (ver README)."]);
  }

  return (
    <div className="dashboard-container" data-theme={theme}>
      {/* ── HEADER ── */}
      <div className="header">
        <div className="header-brand">
          <div>
            <div className="header-title">IOT ENERGY MONITOR</div>
            <div className="header-subtitle">SISTEMA DE MONITOREO ELÉCTRICO</div>
          </div>
        </div>

        <div className="header-stats">
          <div className="stats-group">
            {[
              { label: "ONLINE", value: `${flota.online + flota.retrasado}/${flota.total}`, color: flota.offline ? "var(--color-warning)" : "var(--color-info)" },
              { label: "CONSUMO TOTAL", value: `${(totalConsumo / 1000).toFixed(1)} kW`, color: "var(--color-warning)" },
              { label: "ALERTAS", value: alertCount, color: alertCount > 0 ? "var(--color-danger)" : "var(--color-success)" },
              { label: "LATENCIA PROM.", value: fmtMs(latGlobal), color: "var(--color-purple)" },
            ].map(s => (
              <div key={s.label} className="stat-item">
                <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="sistema-chips">
            <span className="sistema-chip" title={puenteDoc.data ? `Heartbeat ${fmtHace(ahora - (puente.edadS ?? 0) * 1000, ahora)} · RTT broker ${fmtMs(puenteDoc.data.rtt_broker_ms)}` : "Sin datos de sistema/puente"}>
              <span className="estado-dot" style={{ background: colorEstado(puente.estado) }} />
              PUENTE {TEXTO_PUENTE[puente.estado]}
              {puente.estado === "online" && puenteDoc.data?.rtt_broker_ms != null && ` · ${fmtMs(puenteDoc.data.rtt_broker_ms)}`}
            </span>
            <span className="sistema-chip" title={simDoc.data?.evento ? `Último estado: ${simDoc.data.evento}` : "Sin datos de sistema/simulador"}>
              <span className="estado-dot" style={{ background: colorEstado(simEstado) }} />
              SIMULADOR {TEXTO_SIMULADOR[simEstado]}
            </span>
          </div>

          <CentroNotificaciones notif={notif} ahora={ahora} onSeleccionarDispositivo={seleccionar} />
          <button className="theme-toggle-btn" onClick={toggleTheme}>
            {theme === "dark" ? "☀ LIGHT" : "🌙 DARK"}
          </button>
          <div className={`live-indicator ${firestoreOnline === false ? "desconectado" : ""}`}>
            <div className="live-dot" />
            <span className="live-text">{firestoreOnline === false ? "SIN CONEXIÓN" : "EN VIVO"}</span>
          </div>
        </div>
      </div>

      {infraProblemas.length > 0 && (
        <div className="avisos-globales">
          {infraProblemas.map(([tipo, txt]) => <div key={txt} className={`aviso aviso-${tipo}`}>{txt}</div>)}
        </div>
      )}

      <div className="main-content">
        {/* ── SIDEBAR: Casa list ── */}
        <div className="sidebar">
          <div className="sidebar-title">DISPOSITIVOS</div>
          <div className="flota-resumen">
            <span className="estado-online">● {flota.online} online</span>
            {flota.retrasado > 0 && <span className="estado-retrasado">● {flota.retrasado} retrasado</span>}
            {flota.offline > 0 && <span className="estado-offline">● {flota.offline} offline</span>}
          </div>
          <div className="casa-list">
            {dispositivos.map((casa) => {
              const m2 = casa.ultimo?.medicion || {};
              const estado = casa.conectividad.estado;
              const isActive = selDispositivo?.casa_id === casa.casa_id;

              return (
                <div
                  key={casa.casa_id}
                  className={`casa-row ${isActive ? "active" : ""} ${estado === "offline" ? "offline" : ""}`}
                  onClick={() => setSelected(casa.casa_id)}
                >
                  <div className="casa-row-header">
                    <span className="casa-id" style={{ fontSize: 11, color: isActive ? "var(--color-info)" : "var(--text-primary)" }}>
                      {casa.nombre}
                    </span>
                    <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                      {casa.anomalias.length > 0 && estado !== "offline" && <span className="alert-dot" title={casa.anomalias.map((a) => a.descripcion).join("\n")} />}
                      {casa.ultimo?.evento_red && <span className="event-icon">⚡</span>}
                      <EstadoBadge conectividad={casa.conectividad} compacto />
                    </div>
                  </div>
                  <div className="casa-name" style={{ fontSize: 9, color: "var(--text-muted)" }}>
                    {casa.casa_id}
                  </div>
                  <div className="casa-row-footer">
                    <span className="casa-consumo">
                      {m2.consumo_w ? `${m2.consumo_w.toFixed(0)} W` : "—"}
                    </span>
                    {estado === "online"
                      ? <LatenciaChip ms={casa.latencia?.ultima?.mejor} />
                      : <span className={`casa-silencio estado-${estado}`}>
                          {estado === "sin-datos" ? "SIN DATOS" : `${estado.toUpperCase()} · ${fmtDuracion(casa.conectividad.silencioS)}`}
                        </span>}
                  </div>
                </div>
              );
            })}
            {dispositivos.length === 0 && <div className="casa-row nota">Esperando datos de dispositivos…</div>}
          </div>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div className="dashboard-grid">
          {selDispositivo ? (
            <>
              <div className="tabs" role="tablist">
                <button type="button" role="tab" aria-selected={vista === "vivo"} className={vista === "vivo" ? "activo" : ""} onClick={() => setVista("vivo")}>● EN VIVO</button>
                <button type="button" role="tab" aria-selected={vista === "historial"} className={vista === "historial" ? "activo" : ""} onClick={() => setVista("historial")}>⏱ HISTORIAL</button>
              </div>
              {vista === "vivo"
                ? <VistaEnVivo dispositivo={selDispositivo} puente={puenteDoc.data} ahora={ahora} />
                : <HistorialDispositivo casaId={selDispositivo.casa_id} nombre={selDispositivo.nombre} cfgConectividad={cfgCon} />}
            </>
          ) : (
            <div className="panel nota">No hay dispositivos todavía. Verificá que el simulador y el puente estén corriendo.</div>
          )}
        </div>
      </div>

      <Toasts toasts={notif.toasts} onCerrar={notif.cerrarToast} onSeleccionarDispositivo={seleccionar} />
    </div>
  );
}
