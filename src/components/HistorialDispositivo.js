import { useEffect, useMemo, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CONECTIVIDAD, HISTORIAL, UMBRALES } from "../config";
import { useHistorial } from "../hooks/useHistorial";
import { aInputLocal, fmtDateTime, fmtDuracion, fmtMs, fmtNum } from "../utils/formato";
import {
  aCSV, calcularLatencia, contarPorTipo, cortarEnHuecos, detectarAnomalias, detectarHuecos, disponibilidad,
  energiaKWh, estadisticas, reducirLTTB, tsMs, umbralOfflineS,
} from "../utils/telemetria";
import { TIPOS_ANOMALIA } from "../utils/motorNotificaciones";
import { AlertBadge, MetricCard } from "./Indicadores";

const tooltipStyle = { background: "var(--bg-panel)", border: "1px solid var(--border-color)", borderRadius: 6, fontSize: 11 };
const eje = { fill: "var(--text-secondary)", fontSize: 8 };

const TIPOS_EVENTO = {
  DISPOSITIVO_OFFLINE: ["OFFLINE", "ALTA"],
  DISPOSITIVO_ONLINE: ["ONLINE", "INFO"],
};

function ventanaRelativa(rangoId) {
  const r = HISTORIAL.rangos.find((x) => x.id === rangoId)
    || HISTORIAL.rangos.find((x) => x.id === HISTORIAL.rangoDefault);
  const hasta = Date.now() + 60e3; // margen por desfase de relojes
  return { desdeMs: hasta - 60e3 - r.ms, hastaMs: hasta };
}

function modaIntervalo(lecturas) {
  const c = {};
  for (const l of lecturas) if (l.intervalo_s) c[l.intervalo_s] = (c[l.intervalo_s] || 0) + 1;
  const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return top ? Number(top[0]) : CONECTIVIDAD.intervaloDefaultS;
}

function descargar(nombre, contenido) {
  const blob = new Blob(["﻿" + contenido], { type: "text/csv;charset=utf-8" }); // BOM para Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ErrorConsulta({ titulo, error }) {
  if (!error) return null;
  return (
    <div className="aviso aviso-danger">
      <b>{titulo}:</b> {error.mensaje}{" "}
      {error.link && <a href={error.link} target="_blank" rel="noreferrer">Crear índice en Firebase ↗</a>}
      {error.tipo === "indice" && !error.link && " Ver firestore.indexes.json en el repo del dashboard."}
    </div>
  );
}

export default function HistorialDispositivo({ casaId, nombre, cfgConectividad = CONECTIVIDAD }) {
  const [rangoId, setRangoId] = useState(HISTORIAL.rangoDefault);
  const [ventanaCustom, setVentanaCustom] = useState(null);
  const [refresco, setRefresco] = useState(0);
  const [custom, setCustom] = useState(() => ({
    desde: aInputLocal(Date.now() - 3600e3), hasta: aInputLocal(Date.now()),
  }));
  const [limite, setLimite] = useState(HISTORIAL.limiteDefault);
  const [pagina, setPagina] = useState(0);

  // Los rangos relativos se calculan desde "ahora" al elegir rango, cambiar de
  // dispositivo o actualizar. Se deriva en el render (y no en un efecto) para
  // que cada cambio dispare UNA sola consulta a Firestore.
  const ventana = useMemo(
    () => (rangoId === "custom" && ventanaCustom ? ventanaCustom : ventanaRelativa(rangoId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangoId, ventanaCustom, casaId, refresco],
  );

  const h = useHistorial(casaId, ventana.desdeMs, ventana.hastaMs, limite);

  useEffect(() => { setPagina(0); }, [casaId]);

  const elegirRango = (id) => {
    if (id === "custom") {
      // Se queda con la ventana actual hasta que se aplique una nueva
      setVentanaCustom((v) => v || ventana);
    }
    setRangoId(id);
    setPagina(0);
  };

  const aplicarCustom = () => {
    const desdeMs = new Date(custom.desde).getTime();
    const hastaMs = new Date(custom.hasta).getTime();
    if (!Number.isFinite(desdeMs) || !Number.isFinite(hastaMs) || desdeMs >= hastaMs) return;
    setPagina(0);
    setVentanaCustom({ desdeMs, hastaMs });
  };

  const actualizar = () => {
    if (rangoId === "custom") h.recargar();
    else setRefresco((n) => n + 1);
  };

  const analisis = useMemo(() => {
    const lecturas = h.lecturas;
    const intervalo = modaIntervalo(lecturas);
    const umbral = umbralOfflineS(intervalo, cfgConectividad);
    const primera = tsMs(lecturas[0]?.timestamp);
    // Si se alcanzó el límite, el rango real cubierto empieza en la primera lectura
    const desde = h.truncado && primera != null ? primera : ventana.desdeMs;
    const hasta = Math.min(ventana.hastaMs, h.cargadoMs ?? Date.now());
    const huecos = detectarHuecos(lecturas, umbral, desde, hasta);

    const serie = (f) => estadisticas(lecturas.map(f));
    const lat = lecturas.map((l) => calcularLatencia(l));
    const anomaliasLect = [];
    for (const l of lecturas) {
      for (const a of detectarAnomalias(l.medicion)) anomaliasLect.push({ ...a, timestamp: l.timestamp, derivada: true });
    }

    const puntos = lecturas.map((l, i) => ({
      t: tsMs(l.timestamp),
      consumo: l.medicion?.consumo_w ?? null,
      tension: l.medicion?.tension_v ?? null,
      fp: l.medicion?.factor_potencia != null ? l.medicion.factor_potencia * 100 : null,
      frecuencia: l.medicion?.frecuencia_hz ?? null,
      latencia: lat[i] && !lat[i].reenviado ? (lat[i].hastaFirestore ?? lat[i].hastaPuente) : null,
    })).filter((p) => p.t != null);
    const grafico = cortarEnHuecos(reducirLTTB(puntos, HISTORIAL.puntosGrafico, "consumo"), umbral);

    return {
      intervalo, umbral, desde, hasta, huecos, grafico,
      disponibilidad: disponibilidad(huecos, desde, hasta),
      offlineS: huecos.reduce((s, x) => s + x.duracionS, 0),
      energia: energiaKWh(lecturas, umbral),
      consumo: serie((l) => l.medicion?.consumo_w),
      tension: serie((l) => l.medicion?.tension_v),
      fp: serie((l) => l.medicion?.factor_potencia),
      frecuencia: serie((l) => l.medicion?.frecuencia_hz),
      latencia: estadisticas(lat.filter((x) => x && !x.reenviado).map((x) => x.hastaFirestore ?? x.hastaPuente)),
      anomaliasLect,
      anomaliasPorTipo: contarPorTipo(anomaliasLect),
      conAnomalia: lecturas.filter((l) => detectarAnomalias(l.medicion).length > 0).length,
      perdidos: lecturas.reduce((s, l) => s + (l.perdidos_previos || 0), 0),
    };
  }, [h.lecturas, h.truncado, h.cargadoMs, ventana, cfgConectividad]);

  // Línea de tiempo: eventos del puente + alertas (o anomalías derivadas si no hay colección alertas)
  const timeline = useMemo(() => {
    const eventos = h.eventos.map((e) => {
      const [txt, sev] = TIPOS_EVENTO[e.tipo] || [e.tipo, e.severidad || "INFO"];
      const extra = e.duracion_offline_s ? ` (${fmtDuracion(e.duracion_offline_s)} sin datos)` : "";
      return { id: `e-${e.id}`, ts: tsMs(e.timestamp), etiqueta: txt, severidad: sev, texto: (e.descripcion || "") + extra };
    });
    const fuenteAlertas = h.alertas.length ? h.alertas : analisis.anomaliasLect.slice(-HISTORIAL.limiteEventos);
    const alertas = fuenteAlertas.map((a, i) => ({
      id: `a-${a.id || i}`,
      ts: tsMs(a.timestamp),
      etiqueta: a.tipo,
      severidad: a.severidad,
      texto: (TIPOS_ANOMALIA[a.tipo] ? `${TIPOS_ANOMALIA[a.tipo]} — ` : "") + (a.descripcion || "")
        + (a.evento_red ? ` · evento de red: ${a.evento_red}` : ""),
      derivada: a.derivada,
    }));
    return [...eventos, ...alertas].filter((x) => x.ts != null).sort((a, b) => b.ts - a.ts);
  }, [h.eventos, h.alertas, analisis.anomaliasLect]);

  const filas = useMemo(() => h.lecturas.slice().reverse(), [h.lecturas]);
  const totalPaginas = Math.max(1, Math.ceil(filas.length / HISTORIAL.filasPorPagina));
  const paginaActual = Math.min(pagina, totalPaginas - 1);
  const filasPagina = filas.slice(paginaActual * HISTORIAL.filasPorPagina, (paginaActual + 1) * HISTORIAL.filasPorPagina);

  const largo = analisis.hasta - analisis.desde;
  const fmtEje = (t) => {
    const d = new Date(t);
    const hhmm = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    return largo > 20 * 3600e3 ? `${d.getDate()}/${d.getMonth() + 1} ${hhmm}` : hhmm;
  };
  const ejeX = (
    <XAxis dataKey="t" type="number" scale="time" domain={[analisis.desde, analisis.hasta]}
      tickFormatter={fmtEje} tick={eje} allowDataOverflow />
  );
  const areasHuecos = analisis.huecos.slice(-HISTORIAL.maxAreasHuecos).map((g) => (
    <ReferenceArea key={`${g.desdeMs}`} x1={g.desdeMs} x2={g.hastaMs} fill="var(--color-danger)" fillOpacity={0.08}
      stroke="none" ifOverflow="hidden" />
  ));
  const tooltip = <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => fmtDateTime(t)} />;

  const exportar = () => {
    const fecha = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    descargar(`historial_${casaId}_${fecha}.csv`, aCSV(h.lecturas));
  };

  const hayDatos = h.lecturas.length > 0;
  const colorDisp = analisis.disponibilidad == null ? "var(--text-secondary)"
    : analisis.disponibilidad >= 99 ? "var(--color-success)"
      : analisis.disponibilidad >= 90 ? "var(--color-warning)" : "var(--color-danger)";

  return (
    <div className="historial">
      {/* ── Barra de controles ── */}
      <div className="panel historial-toolbar">
        <div className="segmentado" role="group" aria-label="Rango de tiempo">
          {HISTORIAL.rangos.map((r) => (
            <button key={r.id} type="button" className={rangoId === r.id ? "activo" : ""} onClick={() => elegirRango(r.id)}>{r.etiqueta}</button>
          ))}
          <button type="button" className={rangoId === "custom" ? "activo" : ""} onClick={() => elegirRango("custom")}>PERSONALIZADO</button>
        </div>

        {rangoId === "custom" && (
          <div className="rango-custom">
            <label>Desde <input type="datetime-local" value={custom.desde} onChange={(e) => setCustom((c) => ({ ...c, desde: e.target.value }))} /></label>
            <label>Hasta <input type="datetime-local" value={custom.hasta} onChange={(e) => setCustom((c) => ({ ...c, hasta: e.target.value }))} /></label>
            <button type="button" className="btn" onClick={aplicarCustom}>APLICAR</button>
          </div>
        )}

        <div className="historial-acciones">
          <label className="select-label">
            Máx. lecturas
            <select value={limite} onChange={(e) => { setLimite(Number(e.target.value)); setPagina(0); }}>
              {HISTORIAL.limites.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <button type="button" className="btn" onClick={actualizar} disabled={h.cargando}>{h.cargando ? "CARGANDO…" : "↻ ACTUALIZAR"}</button>
          <button type="button" className="btn" onClick={exportar} disabled={!hayDatos}>⬇ CSV</button>
        </div>
      </div>

      <div className="historial-estado">
        {nombre} · {fmtDateTime(analisis.desde)} → {fmtDateTime(analisis.hasta)} · {h.lecturas.length} lecturas
        {h.cargadoMs && ` · consultado ${fmtDateTime(h.cargadoMs)}`}
      </div>

      <ErrorConsulta titulo="Lecturas" error={h.errores.lecturas} />
      <ErrorConsulta titulo="Eventos de conectividad" error={h.errores.eventos} />
      <ErrorConsulta titulo="Alertas" error={h.errores.alertas} />
      {h.truncado && (
        <div className="aviso aviso-warning">
          Se alcanzó el límite de {limite} lecturas: se muestran las más recientes (desde {fmtDateTime(analisis.desde)}).
          Subí el límite o achicá el rango para ver todo el período.
        </div>
      )}

      {!h.cargando && !hayDatos && !h.errores.lecturas && (
        <div className="panel historial-vacio">No hay lecturas de {casaId} en este rango.</div>
      )}

      {hayDatos && (
        <>
          {/* ── Resumen ── */}
          <div className="metrics-grid historial-resumen">
            <MetricCard label="Disponibilidad" texto={analisis.disponibilidad != null ? fmtNum(analisis.disponibilidad, 1) : "—"} unit="%"
              icon="◉" color={colorDisp} sub={`${analisis.huecos.length} corte(s) · ${fmtDuracion(analisis.offlineS)} sin datos`} />
            <MetricCard label="Energía" texto={fmtNum(analisis.energia, 3)} unit="kWh" icon="⚡" color="var(--color-warning)"
              sub={`Consumo prom. ${fmtNum(analisis.consumo.prom, 0)} W · máx ${fmtNum(analisis.consumo.max, 0)} W`} />
            <MetricCard label="Tensión" texto={fmtNum(analisis.tension.prom, 1)} unit="V" icon="〜" color="var(--color-info)"
              sub={`mín ${fmtNum(analisis.tension.min, 1)} · máx ${fmtNum(analisis.tension.max, 1)}`} />
            <MetricCard label="Latencia prom." texto={fmtMs(analisis.latencia.prom)} unit="" icon="⏲" color="var(--color-purple)"
              sub={`p95 ${fmtMs(analisis.latencia.p95)} · hasta Firestore`} />
            <MetricCard label="Factor de potencia" texto={fmtNum(analisis.fp.prom, 3)} unit="" icon="φ" color="var(--color-success)"
              sub={`mín ${fmtNum(analisis.fp.min, 3)}`} />
            <MetricCard label="Frecuencia" texto={fmtNum(analisis.frecuencia.prom, 2)} unit="Hz" icon="∿" color="var(--color-pink)"
              sub={`${fmtNum(analisis.frecuencia.min, 2)} – ${fmtNum(analisis.frecuencia.max, 2)} Hz`} />
            <MetricCard label="Lecturas con anomalía" value={analisis.conAnomalia} unit={`/ ${h.lecturas.length}`} icon="⚠"
              color={analisis.conAnomalia ? "var(--color-danger)" : "var(--color-success)"}
              sub={analisis.anomaliasPorTipo.map(([t, n]) => `${TIPOS_ANOMALIA[t] || t}: ${n}`).join(" · ") || "Sin anomalías"} />
            <MetricCard label="Mensajes perdidos" value={analisis.perdidos} unit="" icon="✕"
              color={analisis.perdidos ? "var(--color-warning)" : "var(--color-success)"}
              sub={`Intervalo ${analisis.intervalo}s · offline tras ${fmtDuracion(analisis.umbral)}`} />
          </div>

          {/* ── Gráficos ── */}
          <div className="charts-grid">
            <div className="panel">
              <div className="chart-title">CONSUMO (W) — HISTORIAL</div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={analisis.grafico} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="hgrad1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-warning)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="var(--color-warning)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  {ejeX}
                  <YAxis tick={eje} />
                  {tooltip}
                  {areasHuecos}
                  <ReferenceLine y={UMBRALES.consumoMax} stroke="var(--color-danger)" strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="consumo" name="Consumo W" stroke="var(--color-warning)" fill="url(#hgrad1)"
                    strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="panel">
              <div className="chart-title">TENSIÓN (V) — HISTORIAL</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={analisis.grafico} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  {ejeX}
                  <YAxis domain={[170, 270]} tick={eje} allowDataOverflow />
                  {tooltip}
                  {areasHuecos}
                  <ReferenceLine y={UMBRALES.tensionMin} stroke="var(--color-danger)" strokeDasharray="4 4" />
                  <ReferenceLine y={UMBRALES.tensionMax} stroke="var(--color-danger)" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="tension" name="Tensión V" stroke="var(--color-info)" strokeWidth={1.5}
                    dot={false} connectNulls={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="panel">
              <div className="chart-title">FACTOR DE POTENCIA (%) Y FRECUENCIA (Hz)</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={analisis.grafico} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  {ejeX}
                  <YAxis yAxisId="fp" domain={[40, 100]} tick={eje} />
                  <YAxis yAxisId="f" orientation="right" domain={[46, 54]} tick={eje} />
                  {tooltip}
                  <ReferenceLine yAxisId="fp" y={UMBRALES.fpMin * 100} stroke="var(--color-danger)" strokeDasharray="4 4" />
                  <Line yAxisId="fp" type="monotone" dataKey="fp" name="FP %" stroke="var(--color-success)" strokeWidth={1.5}
                    dot={false} connectNulls={false} isAnimationActive={false} />
                  <Line yAxisId="f" type="monotone" dataKey="frecuencia" name="Frecuencia Hz" stroke="var(--color-purple)"
                    strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="panel">
              <div className="chart-title">LATENCIA HASTA FIRESTORE (ms)</div>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={analisis.grafico} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                  {ejeX}
                  <YAxis tick={eje} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => fmtDateTime(t)} formatter={(v) => fmtMs(v)} />
                  {areasHuecos}
                  <Line type="monotone" dataKey="latencia" name="Latencia" stroke="var(--color-pink)" strokeWidth={1.5}
                    dot={false} connectNulls={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="historial-listas">
            {/* ── Cortes detectados ── */}
            <div className="panel">
              <div className="chart-title">PERÍODOS SIN DATOS ({analisis.huecos.length})</div>
              {analisis.huecos.length === 0 ? (
                <div className="nota">Sin cortes: el dispositivo reportó durante todo el período.</div>
              ) : (
                <div className="table-container tabla-scroll">
                  <table className="telemetry-table">
                    <thead><tr><th>DESDE</th><th>HASTA</th><th>DURACIÓN</th></tr></thead>
                    <tbody>
                      {analisis.huecos.slice().reverse().map((g) => (
                        <tr key={g.desdeMs} className="telemetry-row">
                          <td>{fmtDateTime(g.desdeMs)}</td>
                          <td>{fmtDateTime(g.hastaMs)}</td>
                          <td style={{ color: "var(--color-danger)" }}>{fmtDuracion(g.duracionS)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Línea de tiempo ── */}
            <div className="panel">
              <div className="chart-title">EVENTOS Y ALERTAS ({timeline.length})</div>
              {!h.alertas.length && analisis.anomaliasLect.length > 0 && (
                <div className="nota">Alertas detectadas a partir de las lecturas (la colección “alertas” no tiene datos para este rango).</div>
              )}
              {timeline.length === 0 ? (
                <div className="nota">Sin eventos en este período.</div>
              ) : (
                <ul className="timeline tabla-scroll">
                  {timeline.map((ev) => (
                    <li key={ev.id} className="timeline-item">
                      <span className="timeline-hora">{fmtDateTime(ev.ts)}</span>
                      <AlertBadge type={ev.etiqueta} severity={ev.severidad} />
                      <span className="timeline-texto">{ev.texto}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* ── Tabla ── */}
          <div className="panel">
            <div className="chart-title">LECTURAS ({filas.length})</div>
            <div className="table-container">
              <table className="telemetry-table">
                <thead>
                  <tr>
                    {["TIMESTAMP", "TENSIÓN V", "CONSUMO W", "CORRIENTE A", "F.P.", "FREQ Hz", "LATENCIA", "SEQ", "ESTADO"].map((t) => <th key={t}>{t}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {filasPagina.map((d) => {
                    const m = d.medicion || {};
                    const an = detectarAnomalias(m);
                    const lat = calcularLatencia(d);
                    return (
                      <tr key={d.id} className="telemetry-row">
                        <td style={{ color: "var(--text-secondary)" }}>{fmtDateTime(d.timestamp)}</td>
                        <td>{m.tension_v?.toFixed(1)}</td>
                        <td>{m.consumo_w?.toFixed(0)}</td>
                        <td>{m.corriente_a?.toFixed(2)}</td>
                        <td>{m.factor_potencia?.toFixed(3)}</td>
                        <td>{m.frecuencia_hz?.toFixed(2)}</td>
                        <td>{fmtMs(lat?.hastaFirestore ?? lat?.hastaPuente)}</td>
                        <td style={{ color: "var(--text-secondary)" }}>{d.seq ?? "—"}</td>
                        <td>
                          {an.length
                            ? <span style={{ color: "var(--color-danger)", fontSize: 9 }} title={an.map((a) => a.descripcion).join("\n")}>⚠ {an.map((a) => a.tipo).join(", ")}</span>
                            : <span style={{ color: "var(--color-success)", fontSize: 9 }}>● NORMAL</span>}
                          {d.evento_red && <span style={{ color: "var(--color-warning)", fontSize: 9, marginLeft: 6 }}>⚡{d.evento_red}</span>}
                          {d.reenviado_offline && <span style={{ color: "var(--color-purple)", fontSize: 9, marginLeft: 6 }}>↺ cola</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPaginas > 1 && (
              <div className="paginacion">
                <button type="button" className="btn" disabled={paginaActual === 0} onClick={() => setPagina(0)}>«</button>
                <button type="button" className="btn" disabled={paginaActual === 0} onClick={() => setPagina(paginaActual - 1)}>‹</button>
                <span>Página {paginaActual + 1} de {totalPaginas}</span>
                <button type="button" className="btn" disabled={paginaActual >= totalPaginas - 1} onClick={() => setPagina(paginaActual + 1)}>›</button>
                <button type="button" className="btn" disabled={paginaActual >= totalPaginas - 1} onClick={() => setPagina(totalPaginas - 1)}>»</button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
