import {
  aCSV, calcularLatencia, contarPorTipo, cortarEnHuecos, detectarAnomalias, detectarHuecos, disponibilidad,
  energiaKWh, estadisticas, estadoConectividad, nivelLatencia, percentil, reducirLTTB, tsMs, umbralOfflineS,
  umbralRetrasoS, vistoMs,
} from "./telemetria";
import { fmtDuracion, fmtMs } from "./formato";

const T0 = Date.parse("2027-01-15T08:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const lectura = (dtS, consumo = 1000, extra = {}) => ({
  timestamp: iso(T0 + dtS * 1000),
  medicion: { consumo_w: consumo, tension_v: 220, factor_potencia: 0.95, frecuencia_hz: 50 },
  ...extra,
});

describe("tsMs", () => {
  test("acepta ISO (también con microsegundos de Python), Timestamp, Date y número", () => {
    expect(tsMs("2027-01-15T08:00:00+00:00")).toBe(T0);
    expect(tsMs("2027-01-15T08:00:00.000000+00:00")).toBe(T0);
    expect(tsMs({ toMillis: () => T0 })).toBe(T0);
    expect(tsMs({ seconds: T0 / 1000, nanoseconds: 0 })).toBe(T0);
    expect(tsMs(new Date(T0))).toBe(T0);
    expect(tsMs(T0)).toBe(T0);
  });
  test("valores inválidos → null", () => {
    expect(tsMs(null)).toBeNull();
    expect(tsMs("no es fecha")).toBeNull();
    expect(tsMs(NaN)).toBeNull();
    expect(tsMs({})).toBeNull();
  });
});

describe("detectarAnomalias", () => {
  test("lectura normal no tiene anomalías", () => {
    expect(detectarAnomalias({ tension_v: 220, consumo_w: 1500, factor_potencia: 0.95, frecuencia_hz: 50 })).toEqual([]);
    expect(detectarAnomalias(null)).toEqual([]);
  });
  test("detecta cada tipo con la severidad del simulador", () => {
    const tipos = (m) => detectarAnomalias(m).map((a) => `${a.tipo}:${a.severidad}`);
    expect(tipos({ tension_v: 190 })).toEqual(["BAJA_TENSION:MEDIA"]);
    expect(tipos({ tension_v: 180 })).toEqual(["BAJA_TENSION:ALTA"]);
    expect(tipos({ tension_v: 250 })).toEqual(["SOBRETENSION:MEDIA"]);
    expect(tipos({ tension_v: 260 })).toEqual(["SOBRETENSION:ALTA"]);
    expect(tipos({ consumo_w: 5000 })).toEqual(["PICO_CONSUMO:MEDIA"]);
    expect(tipos({ consumo_w: 6000 })).toEqual(["PICO_CONSUMO:ALTA"]);
    expect(tipos({ factor_potencia: 0.6 })).toEqual(["FACTOR_POTENCIA_BAJO:BAJA"]);
    expect(tipos({ frecuencia_hz: 52 })).toEqual(["FRECUENCIA_ANORMAL:ALTA"]);
  });
});

describe("calcularLatencia", () => {
  const doc = {
    timestamp: iso(T0),
    enviado_ts: iso(T0 + 20),
    recibido_ts: iso(T0 + 270),
    servidor_ts: { toMillis: () => T0 + 400 },
  };

  test("calcula cada etapa y el total con la hora de llegada", () => {
    const l = calcularLatencia(doc, T0 + 650);
    expect(l).toMatchObject({ cola: 20, red: 250, escritura: 130, entrega: 250, total: 650, hastaFirestore: 400, mejor: 650 });
    expect(l.desfase).toBe(false);
  });

  test("sin llegada (carga inicial / historial) usa hasta Firestore", () => {
    const l = calcularLatencia(doc);
    expect(l.total).toBeNull();
    expect(l.entrega).toBeNull();
    expect(l.mejor).toBe(400);
  });

  test("prefiere las latencias guardadas por el puente", () => {
    const l = calcularLatencia({ ...doc, latencia_ms: { cola: 5, red: 99, hasta_puente: 104 } });
    expect(l.cola).toBe(5);
    expect(l.red).toBe(99);
    expect(l.hastaPuente).toBe(104);
  });

  test("documentos viejos (solo timestamp) funcionan si se vio la llegada", () => {
    expect(calcularLatencia({ timestamp: iso(T0) }, T0 + 900).mejor).toBe(900);
    expect(calcularLatencia({ timestamp: iso(T0) })).toBeNull();
  });

  test("detecta desfase de reloj y mensajes reenviados de la cola", () => {
    expect(calcularLatencia({ ...doc, recibido_ts: iso(T0 - 500) }).desfase).toBe(true);
    expect(calcularLatencia({ ...doc, reenviado_offline: true }).reenviado).toBe(true);
  });

  test("nivelLatencia", () => {
    expect(nivelLatencia(null)).toBe("desconocido");
    expect(nivelLatencia(300)).toBe("normal");
    expect(nivelLatencia(2500)).toBe("advertencia");
    expect(nivelLatencia(9000)).toBe("critica");
  });
});

describe("estadística", () => {
  test("percentil interpola", () => {
    expect(percentil([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentil([0, 10], 95)).toBeCloseTo(9.5);
    expect(percentil([], 95)).toBeNull();
  });
  test("estadisticas ignora nulos", () => {
    expect(estadisticas([3, null, 1, undefined, 2])).toMatchObject({ n: 3, min: 1, max: 3, prom: 2 });
    expect(estadisticas([])).toMatchObject({ n: 0, prom: null });
  });
});

describe("conectividad", () => {
  test("umbrales según intervalo", () => {
    expect(umbralOfflineS(5)).toBe(15);
    expect(umbralOfflineS(10)).toBe(30);
    expect(umbralOfflineS(undefined)).toBe(15);
    expect(umbralRetrasoS(5)).toBe(10);
  });
  test("online → retrasado → offline", () => {
    expect(estadoConectividad(T0, 5, T0 + 3000).estado).toBe("online");
    expect(estadoConectividad(T0, 5, T0 + 12000).estado).toBe("retrasado");
    const off = estadoConectividad(T0, 5, T0 + 16000);
    expect(off).toMatchObject({ estado: "offline", umbralS: 15 });
    expect(off.silencioS).toBeCloseTo(16);
    expect(estadoConectividad(null, 5, T0).estado).toBe("sin-datos");
  });
  test("respeta la config del puente", () => {
    const cfg = { intervaloDefaultS: 5, offlineFactor: 6, offlineMinS: 10, retrasoFactor: 2 };
    expect(estadoConectividad(T0, 5, T0 + 20000, cfg).estado).toBe("retrasado");
  });
  test("reloj futuro (desfase) no da silencio negativo", () => {
    expect(estadoConectividad(T0 + 5000, 5, T0).silencioS).toBe(0);
  });
  test("vistoMs prefiere la llegada, luego servidor_ts", () => {
    const d = { timestamp: iso(T0), servidor_ts: { toMillis: () => T0 + 400 } };
    expect(vistoMs(d, T0 + 900)).toBe(T0 + 900);
    expect(vistoMs(d, null)).toBe(T0 + 400);
    expect(vistoMs({ timestamp: iso(T0) })).toBe(T0);
  });
});

describe("historial", () => {
  const lecturas = [lectura(0), lectura(5), lectura(10), lectura(70), lectura(75)];

  test("detectarHuecos encuentra cortes y bordes del rango", () => {
    expect(detectarHuecos(lecturas, 15)).toEqual([{ desdeMs: T0 + 10000, hastaMs: T0 + 70000, duracionS: 60 }]);
    const conBordes = detectarHuecos(lecturas, 15, T0 - 60000, T0 + 75000);
    expect(conBordes).toHaveLength(2);
    expect(conBordes[0].duracionS).toBe(60);
    expect(detectarHuecos([], 15, T0, T0 + 1000)).toEqual([]);
    expect(detectarHuecos([], 15, T0, T0 + 60000)).toHaveLength(1);
  });

  test("disponibilidad descuenta los huecos", () => {
    const huecos = detectarHuecos(lecturas, 15, T0, T0 + 100000);
    // huecos: 10→70 s (60 s) y 75→100 s (25 s) = 85 s sin datos de 100 s
    expect(disponibilidad(huecos, T0, T0 + 100000)).toBeCloseTo(15);
    expect(disponibilidad([], T0, T0 + 1000)).toBe(100);
    expect(disponibilidad([], T0, T0)).toBeNull();
  });

  test("energía con trapecios, sin integrar sobre huecos", () => {
    // 1000 W durante 10 s + 5 s (el hueco de 60 s no suma) = 15 s → 1000*15/3600 Wh
    expect(energiaKWh(lecturas, 15)).toBeCloseTo((1000 * 15) / 3600 / 1000, 8);
    expect(energiaKWh([lectura(0, 0), lectura(3600, 2000)], 4000)).toBeCloseTo(1);
  });

  test("LTTB conserva extremos y el pico", () => {
    const pts = Array.from({ length: 1000 }, (_, i) => ({ t: i, v: i === 500 ? 9999 : Math.sin(i / 50) }));
    const r = reducirLTTB(pts, 100, "v");
    expect(r).toHaveLength(100);
    expect(r[0].t).toBe(0);
    expect(r[r.length - 1].t).toBe(999);
    expect(r.some((p) => p.v === 9999)).toBe(true);
    expect(reducirLTTB(pts.slice(0, 10), 100, "v")).toHaveLength(10);
  });

  test("cortarEnHuecos inserta un punto nulo en cada corte", () => {
    const r = cortarEnHuecos([{ t: 0, v: 1 }, { t: 5000, v: 1 }, { t: 90000, v: 1 }], 15);
    expect(r).toHaveLength(4);
    expect(r[2]).toMatchObject({ hueco: true });
    expect(r[2].v).toBeUndefined();
  });

  test("contarPorTipo ordena por cantidad", () => {
    expect(contarPorTipo([{ tipo: "A" }, { tipo: "B" }, { tipo: "B" }, {}])).toEqual([["B", 2], ["A", 1]]);
  });

  test("CSV con encabezado, escapado y anomalías", () => {
    const csv = aCSV([
      { ...lectura(0, 6000), casa_id: "CASA_01", nombre: 'Local "A", centro', seq: 7 },
    ]);
    const [cab, fila] = csv.split("\r\n");
    expect(cab.split(",")[0]).toBe("timestamp");
    expect(fila).toContain('"Local ""A"", centro"');
    expect(fila).toContain("PICO_CONSUMO");
    expect(fila).toContain(",7,");
  });
});

describe("formato", () => {
  test("fmtDuracion", () => {
    expect(fmtDuracion(45)).toBe("45s");
    expect(fmtDuracion(200)).toBe("3m 20s");
    expect(fmtDuracion(7500)).toBe("2h 05m");
    expect(fmtDuracion(90000)).toBe("1d 1h");
    expect(fmtDuracion(null)).toBe("—");
  });
  test("fmtMs", () => {
    expect(fmtMs(320.4)).toBe("320 ms");
    expect(fmtMs(1250)).toBe("1.25 s");
    expect(fmtMs(undefined)).toBe("—");
  });
});
