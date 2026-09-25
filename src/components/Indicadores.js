import { fmtDuracion, fmtMs } from "../utils/formato";
import { nivelLatencia } from "../utils/telemetria";

// ── Gauge Component ────────────────────────────────────────────
export function Gauge({ value, max, label, unit, color, subtitle }) {
  const pct = typeof value === "number" ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
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
          stroke="var(--border-panel)"
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
export function MetricCard({ label, value, unit, icon, color, sub, texto }) {
  return (
    <div className="metric-card" style={{ border: `1px solid ${color}33`, borderLeft: `3px solid ${color}` }}>
      <div className="metric-icon">{icon}</div>
      <span className="metric-label">{label}</span>
      <span className="metric-value">
        {texto ?? (typeof value === "number" ? value.toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "--")}
        <span className="metric-unit" style={{ color: color }}>{unit}</span>
      </span>
      {sub && <span className="metric-sub">{sub}</span>}
    </div>
  );
}

// ── Alert Badge ────────────────────────────────────────────────
const COLORES_SEVERIDAD = {
  ALTA: "var(--color-danger)", MEDIA: "var(--color-warning)", BAJA: "#eccc68", INFO: "var(--color-info)",
};

export function AlertBadge({ type, severity }) {
  const c = COLORES_SEVERIDAD[severity] || "var(--color-warning)";
  return (
    <span className="alert-badge" style={{
      background: `color-mix(in srgb, ${c} 14%, transparent)`,
      border: `1px solid ${c}`,
      color: c,
    }}>{type}</span>
  );
}

// ── Estado de conectividad ─────────────────────────────────────
const TEXTO_ESTADO = { online: "ONLINE", retrasado: "RETRASADO", offline: "OFFLINE", "sin-datos": "SIN DATOS" };

export function EstadoBadge({ conectividad, compacto = false }) {
  const estado = conectividad?.estado || "sin-datos";
  const titulo = conectividad?.silencioS != null
    ? `Último dato hace ${fmtDuracion(conectividad.silencioS)} · offline tras ${fmtDuracion(conectividad.umbralS)}`
    : "Todavía no se recibieron datos";
  return (
    <span className={`estado-badge estado-${estado}`} title={titulo}>
      <span className="estado-dot" />
      {!compacto && TEXTO_ESTADO[estado]}
    </span>
  );
}

export function LatenciaChip({ ms, titulo }) {
  const nivel = nivelLatencia(ms);
  return (
    <span className={`latencia-chip latencia-${nivel}`} title={titulo || "Latencia extremo a extremo"}>
      {fmtMs(ms)}
    </span>
  );
}
