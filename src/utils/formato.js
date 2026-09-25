// ── Formateo de fechas, duraciones y números ──────────────────

const valida = (d) => d instanceof Date && !Number.isNaN(d.getTime());

export const fmtTime = (ts) => {
  const d = new Date(ts);
  if (!valida(d)) return String(ts ?? "—");
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

export const fmtDate = (ts) => {
  const d = new Date(ts);
  if (!valida(d)) return String(ts ?? "—");
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export const fmtDateTime = (ts) => {
  const d = new Date(ts);
  if (!valida(d)) return String(ts ?? "—");
  return d.toLocaleDateString("es-AR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
};

/** Segundos → "45s", "3m 20s", "2h 05m", "3d 4h". */
export const fmtDuracion = (seg) => {
  if (seg == null || !Number.isFinite(seg)) return "—";
  const s = Math.max(0, Math.round(seg));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};

/** Milisegundos → "320 ms" / "1.25 s". */
export const fmtMs = (ms) => {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (Math.abs(ms) < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
};

export const fmtHace = (ms, ahora = Date.now()) => {
  if (ms == null || !Number.isFinite(ms)) return "sin datos";
  const seg = (ahora - ms) / 1000;
  if (seg < 2) return "ahora";
  return `hace ${fmtDuracion(seg)}`;
};

export const fmtNum = (v, dec = 1) =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toLocaleString("es-AR", { maximumFractionDigits: dec, minimumFractionDigits: 0 })
    : "—";

/** Valor para <input type="datetime-local"> en hora local. */
export const aInputLocal = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
