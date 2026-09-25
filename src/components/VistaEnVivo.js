import { memo, useMemo } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EN_VIVO, UMBRALES } from "../config";
import { fmtDate, fmtDateTime, fmtDuracion, fmtHace, fmtTime } from "../utils/formato";
import { calcularLatencia, detectarAnomalias } from "../utils/telemetria";
import { EstadoBadge, Gauge, LatenciaChip, MetricCard } from "./Indicadores";
import PanelLatencia from "./PanelLatencia";

const U = UMBRALES;

const severityColor = (val, min, max, warn) => {
  if (val > max || val < min) return "var(--color-danger)";
  if (val > warn) return "var(--color-warning)";
  return "var(--color-success)";
};

const tooltipStyle = { background: "var(--bg-panel)", border: "1px solid var(--border-color)", borderRadius: 6, fontSize: 11 };

// Los gráficos dependen solo de las lecturas: memo evita redibujarlos cada segundo
const GraficosEnVivo = memo(function GraficosEnVivo({ lecturas }) {
  const chartData = useMemo(() => lecturas.slice(0, EN_VIVO.lecturasGrafico).reverse().map((d) => ({
    t: fmtTime(d.timestamp),
    consumo: d.medicion?.consumo_w,
    tension: d.medicion?.tension_v,
    fp: d.medicion?.factor_potencia ? d.medicion.factor_potencia * 100 : null,
    frecuencia: d.medicion?.frecuencia_hz,
  })), [lecturas]);

  return (
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
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="consumo" stroke="var(--color-warning)" fill="url(#grad1)" strokeWidth={2} dot={false} isAnimationActive={false} />
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
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="tension" stroke="var(--color-info)" fill="url(#grad2)" strokeWidth={2} dot={false} isAnimationActive={false} />
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
            <Tooltip contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey="fp" stroke="var(--color-success)" strokeWidth={2} dot={false} isAnimationActive={false} />
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
            <Tooltip contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey="frecuencia" stroke="var(--color-purple)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

export default function VistaEnVivo({ dispositivo, puente, ahora }) {
  const d = dispositivo;
  const ultimo = d.ultimo || {};
  const m = ultimo.medicion || {};
  const con = d.conectividad || {};
  const offline = con.estado === "offline" || con.estado === "sin-datos";

  const tensionColor = severityColor(m.tension_v, U.tensionMin, U.tensionMax, U.tensionWarn);
  const consumoColor = severityColor(m.consumo_w, 0, U.consumoMax, U.consumoWarn);
  const fpColor = m.factor_potencia >= U.fpMin ? "var(--color-success)" : "var(--color-danger)";
  const altoConsumo = m.consumo_w > 4000;

  return (
    <>
      {offline && (
        <div className="aviso aviso-danger aviso-offline">
          <b>DISPOSITIVO {con.estado === "sin-datos" ? "SIN DATOS" : "OFFLINE"}</b>
          {con.silencioS != null
            ? ` — sin datos hace ${fmtDuracion(con.silencioS)} (se considera offline tras ${fmtDuracion(con.umbralS)}). Los valores mostrados son los últimos recibidos.`
            : " — todavía no se recibió ninguna lectura."}
        </div>
      )}

      {/* Casa header */}
      <div className="panel casa-header-panel">
        <div>
          <div className="casa-title">
            {d.casa_id} — {d.nombre} <EstadoBadge conectividad={con} />
          </div>
          <div className="casa-last-update">
            Última actualización: {ultimo.timestamp ? fmtDate(ultimo.timestamp) : "—"} · {fmtHace(d.ultimoVistoMs, ahora)}
            {ultimo.seq != null && ` · seq #${ultimo.seq}`}
            {d.perdidos > 0 && <span className="event-badge">✕ {d.perdidos} mensajes perdidos</span>}
            {ultimo.evento_red && <span className="event-badge">⚡ EVENTO RED: {ultimo.evento_red.toUpperCase()}</span>}
          </div>
        </div>
        <div className="consumo-badge" style={{
          background: altoConsumo ? "rgba(255, 71, 87, 0.13)" : "rgba(46, 213, 115, 0.13)",
          border: `1px solid ${altoConsumo ? "var(--color-danger)" : "var(--color-success)"}`,
          color: altoConsumo ? "var(--color-danger)" : "var(--color-success)",
          opacity: offline ? 0.5 : 1,
        }}>
          {m.consumo_w ? `${(m.consumo_w / 1000).toFixed(2)} kW` : "—"}
        </div>
      </div>

      {/* Gauges */}
      <div className={`panel gauges-container ${offline ? "atenuado" : ""}`}>
        <Gauge value={m.tension_v} max={260} label="TENSIÓN" unit="V" color={tensionColor} subtitle={m.tension_v < U.tensionMin ? "⚠ BAJA" : m.tension_v > U.tensionMax ? "⚠ ALTA" : "NORMAL"} />
        <Gauge value={m.consumo_w} max={5000} label="CONSUMO" unit="W" color={consumoColor} subtitle={m.consumo_w > U.consumoMax ? "⚠ PICO" : "NORMAL"} />
        <Gauge value={m.corriente_a} max={25} label="CORRIENTE" unit="A" color="var(--color-purple)" />
        <Gauge value={m.factor_potencia ? m.factor_potencia * 100 : null} max={100} label="FACTOR POT." unit="%" color={fpColor} subtitle={m.factor_potencia < U.fpMin ? "⚠ BAJO" : "OK"} />
        <Gauge value={m.frecuencia_hz} max={55} label="FRECUENCIA" unit="Hz" color={m.frecuencia_hz >= U.frecuenciaMin && m.frecuencia_hz <= U.frecuenciaMax ? "var(--color-info)" : "var(--color-danger)"} subtitle="50 Hz nominal" />
      </div>

      {/* Metric cards */}
      <div className={`metrics-grid ${offline ? "atenuado" : ""}`}>
        <MetricCard label="Potencia Aparente" value={m.potencia_aparente_va} unit="VA" icon="〜" color="var(--color-purple)" />
        <MetricCard label="Potencia Reactiva" value={m.potencia_reactiva_var} unit="VAR" icon="φ" color="var(--color-pink)" />
        <MetricCard label="Factor Horario" value={m.factor_horario} unit="" icon="⏱" color="#74b9ff" sub="Multiplicador consumo" />
        <MetricCard label="Hora UTC" value={m.hora_utc} unit="h" icon="🌐" color="#55efc4" />
      </div>

      <PanelLatencia casaId={d.casa_id} latencia={d.latencia} puente={puente} />

      <GraficosEnVivo lecturas={d.lecturas} />

      {/* Recent readings table */}
      <div className="panel">
        <div className="chart-title">REGISTRO DE TELEMETRÍA — ÚLTIMAS LECTURAS</div>
        <div className="table-container">
          <table className="telemetry-table">
            <thead>
              <tr>
                {["TIMESTAMP", "DISPOSITIVO", "TENSIÓN V", "CONSUMO W", "CORRIENTE A", "F.P.", "FREQ Hz", "LATENCIA", "ESTADO"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.lecturas.slice(0, EN_VIVO.filasTabla).map((row) => {
                const m2 = row.medicion || {};
                const anomalias = detectarAnomalias(m2);
                const lat = calcularLatencia(row, row._llegadaMs);
                return (
                  <tr key={row.id} className="telemetry-row">
                    <td style={{ color: "var(--text-secondary)" }}>{fmtDateTime(row.timestamp)}</td>
                    <td style={{ color: "var(--color-info)" }}>{row.nombre}</td>
                    <td style={{ color: m2.tension_v < U.tensionMin || m2.tension_v > U.tensionMax ? "var(--color-danger)" : "var(--text-primary)" }}>{m2.tension_v?.toFixed(1)}</td>
                    <td style={{ color: m2.consumo_w > U.consumoMax ? "var(--color-danger)" : "var(--text-primary)" }}>{m2.consumo_w?.toFixed(0)}</td>
                    <td style={{ color: "var(--text-primary)" }}>{m2.corriente_a?.toFixed(2)}</td>
                    <td style={{ color: m2.factor_potencia < U.fpMin ? "var(--color-danger)" : "var(--color-success)" }}>{m2.factor_potencia?.toFixed(3)}</td>
                    <td style={{ color: m2.frecuencia_hz < U.frecuenciaMin || m2.frecuencia_hz > U.frecuenciaMax ? "var(--color-danger)" : "var(--text-primary)" }}>{m2.frecuencia_hz?.toFixed(2)}</td>
                    <td>{lat ? <LatenciaChip ms={lat.reenviado ? null : lat.mejor} /> : "—"}</td>
                    <td>
                      {anomalias.length
                        ? <span style={{ color: "var(--color-danger)", fontSize: 9 }} title={anomalias.map((a) => a.descripcion).join("\n")}>⚠ ALERTA</span>
                        : <span style={{ color: "var(--color-success)", fontSize: 9 }}>● NORMAL</span>}
                      {row.evento_red && <span style={{ color: "var(--color-warning)", fontSize: 9, marginLeft: 6 }}>⚡{row.evento_red}</span>}
                      {row.reenviado_offline && <span style={{ color: "var(--color-purple)", fontSize: 9, marginLeft: 6 }}>↺ cola</span>}
                    </td>
                  </tr>
                );
              })}
              {d.lecturas.length === 0 && (
                <tr><td colSpan={9} className="nota">Sin lecturas recientes en la ventana en vivo.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
