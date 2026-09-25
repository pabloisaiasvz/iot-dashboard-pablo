import { memo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LATENCIA } from "../config";
import { fmtMs, fmtTime } from "../utils/formato";
import { nivelLatencia } from "../utils/telemetria";
import { MetricCard } from "./Indicadores";

const ETAPAS = [
  ["cola", "Cola dispositivo", "var(--color-purple)", "timestamp → enviado_ts"],
  ["red", "Red MQTT", "var(--color-info)", "dispositivo → broker → puente"],
  ["escritura", "Escritura Firestore", "var(--color-warning)", "puente → servidor Firestore"],
  ["entrega", "Entrega al navegador", "var(--color-success)", "Firestore → este dashboard"],
];

const COLOR_NIVEL = {
  normal: "var(--color-success)", advertencia: "var(--color-warning)",
  critica: "var(--color-danger)", desconocido: "var(--text-secondary)",
};

const tooltipStyle = { background: "var(--bg-panel)", border: "1px solid var(--border-color)", borderRadius: 6, fontSize: 11 };

function BarraEtapas({ lat }) {
  const valores = ETAPAS.map(([k]) => Math.max(0, lat?.[k] ?? 0));
  const total = valores.reduce((s, v) => s + v, 0);
  return (
    <div className="lat-etapas">
      <div className="lat-barra" role="img" aria-label="Latencia por etapa">
        {total > 0 && ETAPAS.map(([k, , color], i) => valores[i] > 0 && (
          <div key={k} style={{ width: `${(valores[i] / total) * 100}%`, background: color }} />
        ))}
      </div>
      <div className="lat-leyenda">
        {ETAPAS.map(([k, nombre, color, ayuda]) => (
          <div key={k} className="lat-leyenda-item" title={ayuda}>
            <span className="lat-swatch" style={{ background: color }} />
            <span className="lat-leyenda-nombre">{nombre}</span>
            <span className="lat-leyenda-valor">{lat?.[k] != null ? fmtMs(lat[k]) : "—"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Props estables (latencia viene memoizada) para que memo evite re-render cada segundo
function PanelLatencia({ casaId, latencia: lat, puente: pd }) {
  const ultima = lat?.ultima;
  const s = lat?.stats || {};
  const serie = (lat?.serie || []).map((p) => ({ ...p, hora: fmtTime(p.t) }));
  const colorUltima = COLOR_NIVEL[nivelLatencia(ultima?.mejor)];

  return (
    <div className="panel">
      <div className="chart-title">LATENCIA — {casaId}</div>

      <div className="metrics-grid">
        <MetricCard label="Última" texto={fmtMs(ultima?.mejor)} unit="" icon="⏲" color={colorUltima}
          sub={ultima?.total != null ? "Extremo a extremo" : ultima?.hastaFirestore != null ? "Hasta Firestore" : "Hasta el puente"} />
        <MetricCard label="Promedio" texto={fmtMs(s.prom)} unit="" icon="μ" color={COLOR_NIVEL[nivelLatencia(s.prom)]}
          sub={`${s.n || 0} lecturas`} />
        <MetricCard label="P95" texto={fmtMs(s.p95)} unit="" icon="%" color={COLOR_NIVEL[nivelLatencia(s.p95)]}
          sub="95% por debajo de" />
        <MetricCard label="Máxima" texto={fmtMs(s.max)} unit="" icon="▲" color={COLOR_NIVEL[nivelLatencia(s.max)]}
          sub={`Mín ${fmtMs(s.min)}`} />
      </div>

      <div className="lat-grid">
        <div>
          <div className="chart-subtitle">ÚLTIMA LECTURA POR ETAPA</div>
          <BarraEtapas lat={ultima} />
          <div className="lat-infra">
            <div><span>RTT broker (puente)</span><b>{fmtMs(pd?.rtt_broker_ms)}</b></div>
            <div><span>RTT promedio</span><b>{fmtMs(pd?.rtt_broker_prom_ms)}</b></div>
            <div><span>Commit Firestore prom.</span><b>{fmtMs(pd?.escritura_firestore_prom_ms)}</b></div>
            <div><span>Cola de escritura</span><b>{pd?.cola_escritura ?? "—"}</b></div>
          </div>
        </div>
        <div>
          <div className="chart-subtitle">EVOLUCIÓN (ms)</div>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={serie} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
              <XAxis dataKey="hora" tick={{ fill: "var(--text-secondary)", fontSize: 8 }} />
              <YAxis tick={{ fill: "var(--text-secondary)", fontSize: 8 }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v) => fmtMs(v)} />
              <ReferenceLine y={LATENCIA.advertenciaMs} stroke="var(--color-warning)" strokeDasharray="4 4" />
              <ReferenceLine y={LATENCIA.criticaMs} stroke="var(--color-danger)" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="mejor" name="Latencia" stroke="var(--color-info)" strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {lat?.desfase && (
        <div className="aviso aviso-warning">
          ⚠ Hay etapas con valores negativos: los relojes del simulador, el puente y este navegador no están
          sincronizados. Los totales siguen siendo orientativos.
        </div>
      )}
      {ultima && ultima.entrega == null && (
        <div className="nota">
          La etapa “entrega al navegador” se mide solo con lecturas que llegan con el dashboard abierto.
          {ultima.escritura == null && " Este dispositivo no trae recibido_ts/servidor_ts: actualizá el puente (subscriber_firebase.py)."}
        </div>
      )}
    </div>
  );
}

export default memo(PanelLatencia);
