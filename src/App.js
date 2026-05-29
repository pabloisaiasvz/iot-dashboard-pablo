import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import "./css/styles.css"; // <-- IMPORTA LOS ESTILOS AQUÍ

// ── Firebase config ──────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAQoW0SRvK8xfs_5jeruQUlfqERDvfxqdk",
  authDomain: "iot-energy-monitor-cb06d.firebaseapp.com",
  projectId: "iot-energy-monitor-cb06d",
  storageBucket: "iot-energy-monitor-cb06d.firebasestorage.app",
  messagingSenderId: "852273116904",
  appId: "1:852273116904:web:0755cde8e45ae8411cfb5d",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ── Helpers ───────────────────────────────────────────────────
const fmtTime = (ts) => {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return ts; }
};

const fmtDate = (ts) => {
  try {
    return new Date(ts).toLocaleDateString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return ts; }
};

const severityColor = (val, min, max, warn) => {
  if (val > max || val < min) return "var(--color-danger)";
  if (val > warn) return "var(--color-warning)";
  return "var(--color-success)";
};

const fmtDateTime = (ts) => {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return ts; }
};

// ── Gauge Component ────────────────────────────────────────────
function Gauge({ value, max, label, unit, color, subtitle }) {
  const pct = Math.min(100, (value / max) * 100);
  const r = 52;
  const circ = 2 * Math.PI * r;
  const strokeDash = circ * (270 / 360);

  return (
    <div className="gauge-wrapper">
      <svg width="130" height="100" viewBox="0 0 130 110">
        {/* Background arc */}
        <circle
          cx="65" cy="70" r={r}
          fill="none"
          stroke="var(--border-panel)" /* O usa el valor real que tenías: #1a2332 */
          strokeWidth="10"
          strokeDasharray={`${strokeDash} ${circ}`}
          strokeDashoffset={circ * (45 / 360)}
          strokeLinecap="round"
          transform="rotate(-225 65 70)"
          style={{ stroke: "#1a2332" }}
        />
        {/* Value arc - Se mantiene en línea porque color y pct son dinámicos */}
        <circle
          cx="65" cy="70" r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeDasharray={`${strokeDash * pct / 100} ${circ}`}
          strokeDashoffset={circ * (45 / 360)}
          strokeLinecap="round"
          transform="rotate(-225 65 70)"
          style={{ filter: `drop-shadow(0 0 6px ${color})`, transition: "stroke-dasharray 0.8s ease" }}
        />
        <text x="65" y="68" textAnchor="middle" className="gauge-text-value">
          {typeof value === "number" ? value.toFixed(value > 100 ? 0 : 2) : "--"}
        </text>
        <text x="65" y="82" textAnchor="middle" className="gauge-text-unit">
          {unit}
        </text>
      </svg>
      <span className="gauge-label">{label}</span>
      {subtitle && <span className="gauge-subtitle" style={{ color: color }}>{subtitle}</span>}
    </div>
  );
}

// ── Metric Card ────────────────────────────────────────────────
function MetricCard({ label, value, unit, icon, color, sub }) {
  return (
    <div className="metric-card" style={{ border: `1px solid ${color}33`, borderLeft: `3px solid ${color}` }}>
      <div className="metric-icon">{icon}</div>
      <span className="metric-label">{label}</span>
      <span className="metric-value">
        {typeof value === "number" ? value.toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "--"}
        <span className="metric-unit" style={{ color: color }}>{unit}</span>
      </span>
      {sub && <span className="metric-sub">{sub}</span>}
    </div>
  );
}

// ── Alert Badge ────────────────────────────────────────────────
function AlertBadge({ type, severity }) {
  const colors = { ALTA: "var(--color-danger)", MEDIA: "var(--color-warning)", BAJA: "#eccc68" };
  const c = colors[severity] || "var(--color-warning)";
  return (
    <span style={{
      background: `${c}22`,
      border: `1px solid ${c}`,
      color: c,
      borderRadius: 4,
      padding: "2px 8px",
      fontSize: 10,
      fontFamily: "'JetBrains Mono', monospace",
      letterSpacing: 1,
    }}>{type}</span>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────
export default function Dashboard() {
  const [docs, setDocs] = useState([]);
  const [selected, setSelected] = useState("CASA_01");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const unsubRef = useRef(null);
  const [theme, setTheme] = useState("dark");

  const toggleTheme = () => {
    setTheme(prev => prev === "dark" ? "light" : "dark");
  };

  // Real-time listener
  useEffect(() => {
    const q = query(collection(db, "telemetria"), orderBy("timestamp", "desc"), limit(100));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setDocs(data);
      setLoading(false);
      setTick(t => t + 1);
    }, (err) => {
      setError(err.message);
      setLoading(false);
    });
    unsubRef.current = unsub;
    return () => unsub();
  }, []);

  // Blink animation for live indicator
  const [blink, setBlink] = useState(true);
  useEffect(() => {
    const iv = setInterval(() => setBlink(b => !b), 900);
    return () => clearInterval(iv);
  }, []);

  // Group by casa
  const casas = {};
  docs.forEach(d => {
    if (!casas[d.casa_id]) casas[d.casa_id] = [];
    casas[d.casa_id].push(d);
  });

  const latestPerCasa = Object.entries(casas)
    .map(([id, readings]) => ({
      ...readings[0],
    }))
    .sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));

  useEffect(() => {
    if (!selected && latestPerCasa.length > 0) {
      setSelected(latestPerCasa[0].casa_id); 
    }
  }, [latestPerCasa, selected]);

  const selCasa = latestPerCasa.find(c => c.casa_id === selected) || latestPerCasa[0];
  
  const selHistory = (casas[selected || latestPerCasa[0]?.casa_id] || []).slice(0, 30).reverse();


  const chartData = selHistory.map(d => ({
    t: fmtTime(d.timestamp),
    consumo: d.medicion?.consumo_w,
    tension: d.medicion?.tension_v,
    fp: d.medicion?.factor_potencia ? d.medicion.factor_potencia * 100 : null,
    frecuencia: d.medicion?.frecuencia_hz,
  }));

  console.log("DEBUG: chartData actual:", chartData);

  // Global stats
  const allLatest = latestPerCasa.map(c => c.medicion).filter(Boolean);
  const totalConsumo = allLatest.reduce((s, m) => s + (m.consumo_w || 0), 0);
  const avgTension = allLatest.length ? allLatest.reduce((s, m) => s + (m.tension_v || 0), 0) / allLatest.length : 0;
  const alertCount = docs.filter(d => {
    const m = d.medicion;
    if (!m) return false;
    return m.tension_v < 195 || m.tension_v > 245 || m.consumo_w > 4500 || m.factor_potencia < 0.75 || m.frecuencia_hz < 48.5 || m.frecuencia_hz > 51.5;
  }).length;

  const activeEvents = docs.filter(d => d.evento_red).length;

  if (loading) return (
    <div className="loading-screen">
      <div className="loading-text">CONECTANDO A FIREBASE...</div>
    </div>
  );

  if (error) return (
    <div className="error-screen">
      <div className="error-title">ERROR DE CONEXIÓN</div>
      <div className="error-msg">{error}</div>
    </div>
  );

  const m = selCasa?.medicion || {};
  const tensionColor = severityColor(m.tension_v, 195, 245, 240);
  const consumoColor = severityColor(m.consumo_w, 0, 4500, 3500);
  const fpColor = m.factor_potencia >= 0.75 ? "var(--color-success)" : "var(--color-danger)";

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
              { label: "CASAS", value: latestPerCasa.length, color: "var(--color-info)" },
              { label: "CONSUMO TOTAL", value: `${(totalConsumo / 1000).toFixed(1)} kW`, color: "var(--color-warning)" },
              { label: "ALERTAS", value: alertCount, color: alertCount > 0 ? "var(--color-danger)" : "var(--color-success)" },
            ].map(s => (
              <div key={s.label} className="stat-item">
                <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
                <div className="stat-label">{s.label}</div>
              </div>
            ))}
          </div>
          <button className="theme-toggle-btn" onClick={toggleTheme}>
              {theme === "dark" ? "☀ LIGHT" : "🌙 DARK"}
            </button>
          <div className="live-indicator">
            <div className="live-dot" />
            <span className="live-text">EN VIVO</span>
          </div>
        </div>
      </div>

      <div className="main-content">
        {/* ── SIDEBAR: Casa list ── */}
        <div className="sidebar">
          <div className="sidebar-title">DISPOSITIVOS</div>
          <div className="casa-list">
            {latestPerCasa.map((casa, i) => {
              const m2 = casa.medicion || {};
              const hasAlert = m2.tension_v < 195 || m2.tension_v > 245 || m2.consumo_w > 4500 || m2.factor_potencia < 0.75;
              const isActive = (selected || latestPerCasa[0]?.id) === casa.id;
              
              return (
                <div
                  key={casa.id}
                  className={`casa-row ${isActive ? "active" : ""}`}
                  onClick={() => setSelected(casa.casa_id)}
                >
                  <div className="casa-row-header">
                    <span className="casa-id" style={{ fontSize: 11, color: isActive ? "var(--color-info)" : "var(--text-primary)" }}>
                      {casa.nombre}
                    </span>
                    <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                      {hasAlert && <span className="alert-dot" />}
                      {casa.evento_red && <span className="event-icon">⚡</span>}
                    </div>
                  </div>
                  <div className="casa-name" style={{ fontSize: 9, color: "var(--text-muted)" }}>
                    {casa.id}
                  </div>
                  <div className="casa-consumo">
                    {m2.consumo_w ? `${m2.consumo_w.toFixed(0)} W` : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div className="dashboard-grid">
          
          {/* Casa header */}
          {selCasa && (
            <div className="panel casa-header-panel">
              <div>
                <div className="casa-title">
                  {selCasa.id} — {selCasa.nombre}
                </div>
                <div className="casa-last-update">
                  Última actualización: {fmtDate(selCasa.timestamp)}
                  {selCasa.evento_red && <span className="event-badge">⚡ EVENTO RED: {selCasa.evento_red.toUpperCase()}</span>}
                </div>
              </div>
              <div className="consumo-badge" style={{
                background: m.consumo_w > 4000 ? "rgba(255, 71, 87, 0.13)" : "rgba(46, 213, 115, 0.13)",
                border: `1px solid ${m.consumo_w > 4000 ? "var(--color-danger)" : "var(--color-success)"}`,
                color: m.consumo_w > 4000 ? "var(--color-danger)" : "var(--color-success)"
              }}>
                {m.consumo_w ? `${(m.consumo_w / 1000).toFixed(2)} kW` : "—"}
              </div>
            </div>
          )}

          {/* Gauges */}
          <div className="panel gauges-container">
            <Gauge value={m.tension_v} max={260} label="TENSIÓN" unit="V" color={tensionColor} subtitle={m.tension_v < 195 ? "⚠ BAJA" : m.tension_v > 245 ? "⚠ ALTA" : "NORMAL"} />
            <Gauge value={m.consumo_w} max={5000} label="CONSUMO" unit="W" color={consumoColor} subtitle={m.consumo_w > 4500 ? "⚠ PICO" : "NORMAL"} />
            <Gauge value={m.corriente_a} max={25} label="CORRIENTE" unit="A" color="var(--color-purple)" />
            <Gauge value={m.factor_potencia ? m.factor_potencia * 100 : null} max={100} label="FACTOR POT." unit="%" color={fpColor} subtitle={m.factor_potencia < 0.75 ? "⚠ BAJO" : "OK"} />
            <Gauge value={m.frecuencia_hz} max={55} label="FRECUENCIA" unit="Hz" color={m.frecuencia_hz >= 48.5 && m.frecuencia_hz <= 51.5 ? "var(--color-info)" : "var(--color-danger)"} subtitle="50 Hz nominal" />
          </div>

          {/* Metric cards */}
          <div className="metrics-grid">
            <MetricCard label="Potencia Aparente" value={m.potencia_aparente_va} unit="VA" icon="〜" color="var(--color-purple)" />
            <MetricCard label="Potencia Reactiva" value={m.potencia_reactiva_var} unit="VAR" icon="φ" color="var(--color-pink)" />
            <MetricCard label="Factor Horario" value={m.factor_horario} unit="" icon="⏱" color="#74b9ff" sub="Multiplicador consumo" />
            <MetricCard label="Hora UTC" value={m.hora_utc} unit="h" icon="🌐" color="#55efc4" />
          </div>

          {/* Charts */}
          <div className="charts-grid">
            {/* Consumo chart */}
            <div className="panel">
              <div className="chart-title">CONSUMO (W) — HISTÓRICO</div>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-warning)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-warning)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="t" tick={{ fill: "var(--text-secondary)", fontSize: 8 }} />
                  <YAxis tick={{ fill: "var(--text-secondary)", fontSize: 8 }} />
                  <Tooltip contentStyle={{ background: "var(--bg-panel)", border: "1px solid var(--border-color)", borderRadius: 6, fontSize: 11 }} />
                  <Area type="monotone" dataKey="consumo" stroke="var(--color-warning)" fill="url(#grad1)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Tension chart */}
            <div className="panel">
              <div className="chart-title">TENSIÓN (V) — HISTÓRICO</div>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-info)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-info)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="t" tick={{ fill: "var(--text-secondary)", fontSize: 8 }} />
                  <YAxis domain={[180, 260]} tick={{ fill: "var(--text-secondary)", fontSize: 8 }} />
                  <Tooltip contentStyle={{ background: "var(--bg-panel)", border: "1px solid var(--border-color)", borderRadius: 6, fontSize: 11 }} />
                  <Area type="monotone" dataKey="tension" stroke="var(--color-info)" fill="url(#grad2)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* FP chart */}
            <div className="panel">
              <div className="chart-title">FACTOR DE POTENCIA (%) — HISTÓRICO</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="t" tick={{ fill: "var(--text-secondary)", fontSize: 8 }} />
                  <YAxis domain={[60, 100]} tick={{ fill: "var(--text-secondary)", fontSize: 8 }} />
                  <Tooltip contentStyle={{ background: "var(--bg-panel)", border: "1px solid var(--border-color)", borderRadius: 6, fontSize: 11 }} />
                  <Line type="monotone" dataKey="fp" stroke="var(--color-success)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Frecuencia chart */}
            <div className="panel">
              <div className="chart-title">FRECUENCIA (Hz) — HISTÓRICO</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  <XAxis dataKey="t" tick={{ fill: "var(--text-secondary)", fontSize: 8 }} />
                  <YAxis domain={[47, 53]} tick={{ fill: "var(--text-secondary)", fontSize: 8 }} />
                  <Tooltip contentStyle={{ background: "var(--bg-panel)", border: "1px solid var(--border-color)", borderRadius: 6, fontSize: 11 }} />
                  <Line type="monotone" dataKey="frecuencia" stroke="var(--color-purple)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent alerts table */}
          <div className="panel">
            <div className="chart-title">REGISTRO DE TELEMETRÍA — ÚLTIMAS LECTURAS</div>
            <div className="table-container">
              <table className="telemetry-table">
                <thead>
                  <tr>
                    {["TIMESTAMP", "DISPOSITIVO", "TENSIÓN V", "CONSUMO W", "CORRIENTE A", "F.P.", "FREQ Hz", "ESTADO"].map(h => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                  <tbody>
                    {docs
                      .filter((d) => selCasa && d.casa_id === selCasa.casa_id)
                      .slice(0, 12)
                      .map((d) => {
                        const m2 = d.medicion || {};
                        const hasAlert = m2.tension_v < 195 || m2.tension_v > 245 || m2.consumo_w > 4500 || m2.factor_potencia < 0.75;
                        return (
                          <tr key={d.id} className="telemetry-row">
                            <td style={{ color: "var(--text-secondary)" }}>{fmtDateTime(d.timestamp)}</td>
                            <td style={{ color: "var(--color-info)",}}>{d.nombre}</td>
                            <td style={{ color: m2.tension_v < 195 || m2.tension_v > 245 ? "var(--color-danger)" : "var(--text-primary)" }}>{m2.tension_v?.toFixed(1)}</td>
                            <td style={{ color: m2.consumo_w > 4500 ? "var(--color-danger)" : "var(--text-primary)" }}>{m2.consumo_w?.toFixed(0)}</td>
                            <td style={{ color: "var(--text-primary)" }}>{m2.corriente_a?.toFixed(2)}</td>
                            <td style={{ color: m2.factor_potencia < 0.75 ? "var(--color-danger)" : "var(--color-success)" }}>{m2.factor_potencia?.toFixed(3)}</td>
                            <td style={{ color: m2.frecuencia_hz < 48.5 || m2.frecuencia_hz > 51.5 ? "var(--color-danger)" : "var(--text-primary)" }}>{m2.frecuencia_hz?.toFixed(2)}</td>
                            <td>
                              {hasAlert
                                ? <span style={{ color: "var(--color-danger)", fontSize: 9 }}>⚠ ALERTA</span>
                                : <span style={{ color: "var(--color-success)", fontSize: 9 }}>● NORMAL</span>}
                              {d.evento_red && <span style={{ color: "var(--color-warning)", fontSize: 9, marginLeft: 6 }}>⚡{d.evento_red}</span>}
                            </td>
                          </tr>
                        );
                    })}
                  </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}