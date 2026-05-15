import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, orderBy, limit, onSnapshot } from "firebase/firestore";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

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
  if (val > max || val < min) return "#ff4757";
  if (val > warn) return "#ffa502";
  return "#2ed573";
};

// ── Gauge Component ────────────────────────────────────────────
function Gauge({ value, max, label, unit, color, subtitle }) {
  const pct = Math.min(100, (value / max) * 100);
  const r = 52;
  const circ = 2 * Math.PI * r;
  const strokeDash = circ * (270 / 360);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg width="130" height="100" viewBox="0 0 130 110">
        {/* Background arc */}
        <circle
          cx="65" cy="70" r={r}
          fill="none"
          stroke="#1a2332"
          strokeWidth="10"
          strokeDasharray={`${strokeDash} ${circ}`}
          strokeDashoffset={circ * (45 / 360)}
          strokeLinecap="round"
          transform="rotate(-225 65 70)"
        />
        {/* Value arc */}
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
        <text x="65" y="68" textAnchor="middle" fill="#e8f4fd" fontSize="18" fontWeight="700" fontFamily="'JetBrains Mono', monospace">
          {typeof value === "number" ? value.toFixed(value > 100 ? 0 : 2) : "--"}
        </text>
        <text x="65" y="82" textAnchor="middle" fill="#4a7fa5" fontSize="9" fontFamily="'JetBrains Mono', monospace">
          {unit}
        </text>
      </svg>
      <span style={{ color: "#7fb3d3", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", letterSpacing: 1 }}>{label}</span>
      {subtitle && <span style={{ color: color, fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>{subtitle}</span>}
    </div>
  );
}

// ── Metric Card ────────────────────────────────────────────────
function MetricCard({ label, value, unit, icon, color, sub }) {
  return (
    <div style={{
      background: "linear-gradient(135deg, #0d1b2a 0%, #112233 100%)",
      border: `1px solid ${color}33`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 8,
      padding: "14px 18px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{ position: "absolute", top: 10, right: 14, fontSize: 22, opacity: 0.15 }}>{icon}</div>
      <span style={{ color: "#4a7fa5", fontSize: 10, letterSpacing: 2, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase" }}>{label}</span>
      <span style={{ color: "#e8f4fd", fontSize: 24, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
        {typeof value === "number" ? value.toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "--"}
        <span style={{ fontSize: 12, color: color, marginLeft: 4 }}>{unit}</span>
      </span>
      {sub && <span style={{ color: "#4a7fa5", fontSize: 10, fontFamily: "'JetBrains Mono', monospace" }}>{sub}</span>}
    </div>
  );
}

// ── Alert Badge ────────────────────────────────────────────────
function AlertBadge({ type, severity }) {
  const colors = { ALTA: "#ff4757", MEDIA: "#ffa502", BAJA: "#eccc68" };
  const c = colors[severity] || "#ffa502";
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
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const unsubRef = useRef(null);

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

  // Latest reading per casa
  const latestPerCasa = Object.entries(casas).map(([id, readings]) => ({
    id,
    ...readings[0],
  }));

  // Selected casa data
  const selCasa = selected
    ? latestPerCasa.find(c => c.id === selected)
    : latestPerCasa[0];

  const selHistory = selected
    ? (casas[selected] || []).slice(0, 30).reverse()
    : (casas[latestPerCasa[0]?.id] || []).slice(0, 30).reverse();

  const chartData = selHistory.map(d => ({
    t: fmtTime(d.timestamp),
    consumo: d.medicion?.consumo_w,
    tension: d.medicion?.tension_v,
    fp: d.medicion?.factor_potencia ? d.medicion.factor_potencia * 100 : null,
    frecuencia: d.medicion?.frecuencia_hz,
  }));

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
    <div style={{ background: "#070f1a", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ color: "#2ed573", fontFamily: "'JetBrains Mono', monospace", fontSize: 14, letterSpacing: 2 }}>
        CONECTANDO A FIREBASE...
      </div>
    </div>
  );

  if (error) return (
    <div style={{ background: "#070f1a", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
      <div style={{ color: "#ff4757", fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>ERROR DE CONEXIÓN</div>
      <div style={{ color: "#4a7fa5", fontFamily: "'JetBrains Mono', monospace", fontSize: 11 }}>{error}</div>
    </div>
  );

  const m = selCasa?.medicion || {};
  const tensionColor = severityColor(m.tension_v, 195, 245, 240);
  const consumoColor = severityColor(m.consumo_w, 0, 4500, 3500);
  const fpColor = m.factor_potencia >= 0.75 ? "#2ed573" : "#ff4757";

  return (
    <div style={{
      background: "#070f1a",
      minHeight: "100vh",
      fontFamily: "'JetBrains Mono', monospace",
      color: "#e8f4fd",
      padding: "0 0 40px 0",
    }}>
      {/* Google Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;600;700&family=Rajdhani:wght@300;400;600;700&display=swap');
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: #070f1a; }
        ::-webkit-scrollbar-thumb { background: #1a3a5c; border-radius: 2px; }
        .casa-row:hover { background: #112233 !important; cursor: pointer; }
        .casa-row.active { background: #0d2040 !important; border-left: 2px solid #00d4ff !important; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes slideIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{
        background: "linear-gradient(90deg, #0a1628 0%, #0d1f35 100%)",
        borderBottom: "1px solid #1a3a5c",
        padding: "0 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 60,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 6,
            background: "linear-gradient(135deg, #00d4ff, #0066cc)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16,
          }}>⚡</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#e8f4fd", fontFamily: "'Rajdhani', sans-serif", letterSpacing: 2 }}>
              IOT ENERGY MONITOR
            </div>
            <div style={{ fontSize: 9, color: "#4a7fa5", letterSpacing: 3 }}>SISTEMA DE MONITOREO ELÉCTRICO</div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div style={{ display: "flex", gap: 20 }}>
            {[
              { label: "CASAS", value: latestPerCasa.length, color: "#00d4ff" },
              { label: "CONSUMO TOTAL", value: `${(totalConsumo / 1000).toFixed(1)} kW`, color: "#ffa502" },
              { label: "ALERTAS", value: alertCount, color: alertCount > 0 ? "#ff4757" : "#2ed573" },
            ].map(s => (
              <div key={s.label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 8, color: "#4a7fa5", letterSpacing: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: "#2ed573",
              animation: "pulse 1.8s ease-in-out infinite",
              boxShadow: "0 0 8px #2ed573",
            }} />
            <span style={{ fontSize: 9, color: "#2ed573", letterSpacing: 2 }}>EN VIVO</span>
          </div>
        </div>
      </div>

      <div style={{ padding: "24px 32px", display: "flex", gap: 24 }}>

        {/* ── SIDEBAR: Casa list ── */}
        <div style={{
          width: 220,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}>
          <div style={{ fontSize: 9, color: "#4a7fa5", letterSpacing: 3, marginBottom: 4 }}>DISPOSITIVOS</div>
          <div style={{
            background: "#0a1628",
            border: "1px solid #1a3a5c",
            borderRadius: 8,
            overflow: "hidden",
          }}>
            {latestPerCasa.map((casa, i) => {
              const m2 = casa.medicion || {};
              const hasAlert = m2.tension_v < 195 || m2.tension_v > 245 || m2.consumo_w > 4500 || m2.factor_potencia < 0.75;
              const isActive = (selected || latestPerCasa[0]?.id) === casa.id;
              return (
                <div
                  key={casa.id}
                  className={`casa-row${isActive ? " active" : ""}`}
                  onClick={() => setSelected(casa.id)}
                  style={{
                    padding: "10px 14px",
                    borderBottom: i < latestPerCasa.length - 1 ? "1px solid #0d1b2a" : "none",
                    borderLeft: isActive ? "2px solid #00d4ff" : "2px solid transparent",
                    background: isActive ? "#0d2040" : "transparent",
                    transition: "all 0.2s",
                    animation: "slideIn 0.3s ease",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: isActive ? "#00d4ff" : "#7fb3d3" }}>{casa.id}</span>
                    {hasAlert && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ff4757", display: "inline-block" }} />}
                    {casa.evento_red && <span style={{ fontSize: 8, color: "#ffa502" }}>⚡</span>}
                  </div>
                  <div style={{ fontSize: 9, color: "#4a7fa5", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {casa.nombre}
                  </div>
                  <div style={{ fontSize: 11, color: "#e8f4fd", marginTop: 4, fontWeight: 600 }}>
                    {m2.consumo_w ? `${m2.consumo_w.toFixed(0)} W` : "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Casa header */}
          {selCasa && (
            <div style={{
              background: "linear-gradient(135deg, #0a1628 0%, #0d1f35 100%)",
              border: "1px solid #1a3a5c",
              borderRadius: 10,
              padding: "16px 24px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#e8f4fd", fontFamily: "'Rajdhani', sans-serif", letterSpacing: 2 }}>
                  {selCasa.id} — {selCasa.nombre}
                </div>
                <div style={{ fontSize: 10, color: "#4a7fa5", marginTop: 2 }}>
                  Última actualización: {fmtDate(selCasa.timestamp)}
                  {selCasa.evento_red && <span style={{ color: "#ffa502", marginLeft: 12 }}>⚡ EVENTO RED: {selCasa.evento_red.toUpperCase()}</span>}
                </div>
              </div>
              <div style={{
                background: m.consumo_w > 4000 ? "#ff475722" : "#2ed57322",
                border: `1px solid ${m.consumo_w > 4000 ? "#ff4757" : "#2ed573"}`,
                borderRadius: 6, padding: "6px 16px",
                fontSize: 22, fontWeight: 700,
                color: m.consumo_w > 4000 ? "#ff4757" : "#2ed573",
              }}>
                {m.consumo_w ? `${(m.consumo_w / 1000).toFixed(2)} kW` : "—"}
              </div>
            </div>
          )}

          {/* Gauges */}
          <div style={{
            background: "linear-gradient(135deg, #0a1628 0%, #0d1f35 100%)",
            border: "1px solid #1a3a5c",
            borderRadius: 10,
            padding: "20px",
            display: "flex",
            justifyContent: "space-around",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}>
            <Gauge value={m.tension_v} max={260} label="TENSIÓN" unit="V" color={tensionColor} subtitle={m.tension_v < 195 ? "⚠ BAJA" : m.tension_v > 245 ? "⚠ ALTA" : "NORMAL"} />
            <Gauge value={m.consumo_w} max={5000} label="CONSUMO" unit="W" color={consumoColor} subtitle={m.consumo_w > 4500 ? "⚠ PICO" : "NORMAL"} />
            <Gauge value={m.corriente_a} max={25} label="CORRIENTE" unit="A" color="#a29bfe" />
            <Gauge value={m.factor_potencia ? m.factor_potencia * 100 : null} max={100} label="FACTOR POT." unit="%" color={fpColor} subtitle={m.factor_potencia < 0.75 ? "⚠ BAJO" : "OK"} />
            <Gauge value={m.frecuencia_hz} max={55} label="FRECUENCIA" unit="Hz" color={m.frecuencia_hz >= 48.5 && m.frecuencia_hz <= 51.5 ? "#00d4ff" : "#ff4757"} subtitle="50 Hz nominal" />
          </div>

          {/* Metric cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <MetricCard label="Potencia Aparente" value={m.potencia_aparente_va} unit="VA" icon="〜" color="#a29bfe" />
            <MetricCard label="Potencia Reactiva" value={m.potencia_reactiva_var} unit="VAR" icon="φ" color="#fd79a8" />
            <MetricCard label="Factor Horario" value={m.factor_horario} unit="" icon="⏱" color="#74b9ff" sub="Multiplicador consumo" />
            <MetricCard label="Hora UTC" value={m.hora_utc} unit="h" icon="🌐" color="#55efc4" />
          </div>

          {/* Charts */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {/* Consumo chart */}
            <div style={{
              background: "linear-gradient(135deg, #0a1628 0%, #0d1f35 100%)",
              border: "1px solid #1a3a5c",
              borderRadius: 10,
              padding: "16px",
            }}>
              <div style={{ fontSize: 9, color: "#4a7fa5", letterSpacing: 3, marginBottom: 12 }}>CONSUMO (W) — HISTÓRICO</div>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ffa502" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ffa502" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a3a5c" />
                  <XAxis dataKey="t" tick={{ fill: "#4a7fa5", fontSize: 8 }} />
                  <YAxis tick={{ fill: "#4a7fa5", fontSize: 8 }} />
                  <Tooltip contentStyle={{ background: "#0a1628", border: "1px solid #1a3a5c", borderRadius: 6, fontSize: 11 }} />
                  <Area type="monotone" dataKey="consumo" stroke="#ffa502" fill="url(#grad1)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Tension chart */}
            <div style={{
              background: "linear-gradient(135deg, #0a1628 0%, #0d1f35 100%)",
              border: "1px solid #1a3a5c",
              borderRadius: 10,
              padding: "16px",
            }}>
              <div style={{ fontSize: 9, color: "#4a7fa5", letterSpacing: 3, marginBottom: 12 }}>TENSIÓN (V) — HISTÓRICO</div>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="grad2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a3a5c" />
                  <XAxis dataKey="t" tick={{ fill: "#4a7fa5", fontSize: 8 }} />
                  <YAxis domain={[180, 260]} tick={{ fill: "#4a7fa5", fontSize: 8 }} />
                  <Tooltip contentStyle={{ background: "#0a1628", border: "1px solid #1a3a5c", borderRadius: 6, fontSize: 11 }} />
                  <Area type="monotone" dataKey="tension" stroke="#00d4ff" fill="url(#grad2)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* FP chart */}
            <div style={{
              background: "linear-gradient(135deg, #0a1628 0%, #0d1f35 100%)",
              border: "1px solid #1a3a5c",
              borderRadius: 10,
              padding: "16px",
            }}>
              <div style={{ fontSize: 9, color: "#4a7fa5", letterSpacing: 3, marginBottom: 12 }}>FACTOR DE POTENCIA (%) — HISTÓRICO</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a3a5c" />
                  <XAxis dataKey="t" tick={{ fill: "#4a7fa5", fontSize: 8 }} />
                  <YAxis domain={[60, 100]} tick={{ fill: "#4a7fa5", fontSize: 8 }} />
                  <Tooltip contentStyle={{ background: "#0a1628", border: "1px solid #1a3a5c", borderRadius: 6, fontSize: 11 }} />
                  <Line type="monotone" dataKey="fp" stroke="#2ed573" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Frecuencia chart */}
            <div style={{
              background: "linear-gradient(135deg, #0a1628 0%, #0d1f35 100%)",
              border: "1px solid #1a3a5c",
              borderRadius: 10,
              padding: "16px",
            }}>
              <div style={{ fontSize: 9, color: "#4a7fa5", letterSpacing: 3, marginBottom: 12 }}>FRECUENCIA (Hz) — HISTÓRICO</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a3a5c" />
                  <XAxis dataKey="t" tick={{ fill: "#4a7fa5", fontSize: 8 }} />
                  <YAxis domain={[47, 53]} tick={{ fill: "#4a7fa5", fontSize: 8 }} />
                  <Tooltip contentStyle={{ background: "#0a1628", border: "1px solid #1a3a5c", borderRadius: 6, fontSize: 11 }} />
                  <Line type="monotone" dataKey="frecuencia" stroke="#a29bfe" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Recent alerts table */}
          <div style={{
            background: "linear-gradient(135deg, #0a1628 0%, #0d1f35 100%)",
            border: "1px solid #1a3a5c",
            borderRadius: 10,
            padding: "16px",
          }}>
            <div style={{ fontSize: 9, color: "#4a7fa5", letterSpacing: 3, marginBottom: 12 }}>REGISTRO DE TELEMETRÍA — ÚLTIMAS LECTURAS</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1a3a5c" }}>
                    {["TIMESTAMP", "CASA", "TENSIÓN V", "CONSUMO W", "CORRIENTE A", "F.P.", "FREQ Hz", "ESTADO"].map(h => (
                      <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: "#4a7fa5", fontWeight: 400, letterSpacing: 1 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {docs.slice(0, 12).map((d, i) => {
                    const m2 = d.medicion || {};
                    const hasAlert = m2.tension_v < 195 || m2.tension_v > 245 || m2.consumo_w > 4500 || m2.factor_potencia < 0.75;
                    return (
                      <tr key={d.id} style={{ borderBottom: "1px solid #0d1b2a", background: i % 2 === 0 ? "transparent" : "#0a1628" }}>
                        <td style={{ padding: "6px 10px", color: "#4a7fa5" }}>{fmtTime(d.timestamp)}</td>
                        <td style={{ padding: "6px 10px", color: "#00d4ff" }}>{d.casa_id}</td>
                        <td style={{ padding: "6px 10px", color: m2.tension_v < 195 || m2.tension_v > 245 ? "#ff4757" : "#e8f4fd" }}>{m2.tension_v?.toFixed(1)}</td>
                        <td style={{ padding: "6px 10px", color: m2.consumo_w > 4500 ? "#ff4757" : "#e8f4fd" }}>{m2.consumo_w?.toFixed(0)}</td>
                        <td style={{ padding: "6px 10px", color: "#e8f4fd" }}>{m2.corriente_a?.toFixed(2)}</td>
                        <td style={{ padding: "6px 10px", color: m2.factor_potencia < 0.75 ? "#ff4757" : "#2ed573" }}>{m2.factor_potencia?.toFixed(3)}</td>
                        <td style={{ padding: "6px 10px", color: m2.frecuencia_hz < 48.5 || m2.frecuencia_hz > 51.5 ? "#ff4757" : "#e8f4fd" }}>{m2.frecuencia_hz?.toFixed(2)}</td>
                        <td style={{ padding: "6px 10px" }}>
                          {hasAlert
                            ? <span style={{ color: "#ff4757", fontSize: 9 }}>⚠ ALERTA</span>
                            : <span style={{ color: "#2ed573", fontSize: 9 }}>● NORMAL</span>}
                          {d.evento_red && <span style={{ color: "#ffa502", fontSize: 9, marginLeft: 6 }}>⚡{d.evento_red}</span>}
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