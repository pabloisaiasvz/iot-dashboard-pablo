import { crearMotor, estadoSimulador, evaluarEstado, evaluarLectura } from "./motorNotificaciones";
import { agruparDispositivos, aplicarConectividad, configConectividad, estadoPuente, resumenFlota } from "./dispositivos";

const T0 = Date.parse("2027-01-15T08:00:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

const dispositivo = (id, estado, extra = {}) => ({
  casa_id: id, nombre: `Casa ${id}`, ultimoVistoMs: T0,
  conectividad: { estado, silencioS: estado === "offline" ? 20 : 1, umbralS: 15 }, ...extra,
});
const PUENTE_OK = { estado: "online", edadS: 3 };
const ctx = (dispositivos, extra = {}) => ({
  dispositivos, puente: PUENTE_OK, firestoreOnline: true, simulador: null, ahora: T0, ...extra,
});

describe("evaluarEstado: conectividad", () => {
  test("la primera evaluación no notifica transiciones, solo un resumen de offline", () => {
    const m = crearMotor();
    const n = evaluarEstado(m, ctx([dispositivo("A", "online"), dispositivo("B", "offline"), dispositivo("C", "offline")]));
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ clave: "inicio:offline", severidad: "media" });
    expect(n[0].mensaje).toContain("B, C");
    expect(evaluarEstado(m, ctx([dispositivo("A", "online")]))).toEqual([]);
  });

  test("online → offline → online con duración", () => {
    const m = crearMotor();
    evaluarEstado(m, ctx([dispositivo("A", "online")]));
    expect(evaluarEstado(m, ctx([dispositivo("A", "retrasado")]))).toEqual([]);

    const off = evaluarEstado(m, ctx([dispositivo("A", "offline")]));
    expect(off).toHaveLength(1);
    expect(off[0]).toMatchObject({ clave: "offline:A", severidad: "alta", casa_id: "A" });
    expect(evaluarEstado(m, ctx([dispositivo("A", "offline")]))).toEqual([]); // no repite

    const on = evaluarEstado(m, ctx([dispositivo("A", "online", { ultimoVistoMs: T0 + 95000 })]));
    expect(on[0]).toMatchObject({ clave: "online:A", severidad: "ok" });
    expect(on[0].mensaje).toContain("1m 35s");
  });

  test("con el puente caído no se notifica cada dispositivo, solo el puente", () => {
    const m = crearMotor();
    evaluarEstado(m, ctx([dispositivo("A", "online"), dispositivo("B", "online")]));
    const caido = { estado: "caido", edadS: 60 };
    const n = evaluarEstado(m, ctx([dispositivo("A", "offline"), dispositivo("B", "offline")], { puente: caido }));
    expect(n.map((x) => x.clave)).toEqual(["puente"]);
    expect(n[0].severidad).toBe("critica");

    // Cuando vuelve, se avisa del puente pero no "volvió online" de dispositivos suprimidos
    const r = evaluarEstado(m, ctx([dispositivo("A", "online"), dispositivo("B", "online")]));
    expect(r.map((x) => x.clave)).toEqual(["puente"]);
    expect(r[0].severidad).toBe("ok");
  });

  test("sin Firestore tampoco se notifican dispositivos", () => {
    const m = crearMotor();
    evaluarEstado(m, ctx([dispositivo("A", "online")]));
    const n = evaluarEstado(m, ctx([dispositivo("A", "offline")], { firestoreOnline: false }));
    expect(n.map((x) => x.clave)).toEqual(["firestore"]);
    const r = evaluarEstado(m, ctx([dispositivo("A", "online")]));
    expect(r.map((x) => `${x.clave}:${x.severidad}`)).toEqual(["firestore:ok"]);
  });

  test("dispositivo nuevo", () => {
    const m = crearMotor();
    evaluarEstado(m, ctx([]));
    const n = evaluarEstado(m, ctx([dispositivo("Z", "online")]));
    expect(n[0]).toMatchObject({ clave: "nuevo:Z", severidad: "info" });
  });

  test("simulador desconectado por Last Will", () => {
    const m = crearMotor();
    evaluarEstado(m, ctx([], { simulador: { estado: "online", actualizado: iso(T0) } }));
    const n = evaluarEstado(m, ctx([], { simulador: { estado: "offline", evento: "SIMULADOR_DESCONECTADO" } }));
    expect(n[0]).toMatchObject({ clave: "simulador", severidad: "alta" });
  });

  test("fin de evento de red", () => {
    const m = crearMotor();
    evaluarEstado(m, ctx([]));
    evaluarLectura(m, { casa_id: "A", evento_red: "baja_tension", medicion: {} }, T0);
    expect(evaluarEstado(m, ctx([], { ahora: T0 + 5000 }))).toEqual([]);
    const n = evaluarEstado(m, ctx([], { ahora: T0 + 60000 }));
    expect(n[0]).toMatchObject({ clave: "red-fin:baja_tension", severidad: "ok" });
  });
});

describe("evaluarLectura", () => {
  test("anomalías con clave por dispositivo y tipo", () => {
    const n = evaluarLectura(crearMotor(), { casa_id: "A", nombre: "Casa A", medicion: { consumo_w: 6000, tension_v: 180 } }, T0);
    expect(n.map((x) => x.clave).sort()).toEqual(["anomalia:A:BAJA_TENSION", "anomalia:A:PICO_CONSUMO"]);
    expect(n.every((x) => x.severidad === "alta")).toBe(true);
  });

  test("evento de red se notifica una vez al empezar", () => {
    const m = crearMotor();
    const d = { casa_id: "A", evento_red: "sobretension", medicion: {} };
    expect(evaluarLectura(m, d, T0).map((x) => x.clave)).toEqual(["red:sobretension"]);
    expect(evaluarLectura(m, { ...d, casa_id: "B" }, T0 + 1)).toEqual([]);
  });

  test("latencia alta solo tras N lecturas consecutivas", () => {
    const m = crearMotor();
    const lenta = (i) => ({ casa_id: "A", timestamp: iso(T0 + i), medicion: {}, _llegadaMs: T0 + i + 9000 });
    const rapida = { casa_id: "A", timestamp: iso(T0), medicion: {}, _llegadaMs: T0 + 100 };
    expect(evaluarLectura(m, lenta(1), T0)).toEqual([]);
    expect(evaluarLectura(m, lenta(2), T0)).toEqual([]);
    evaluarLectura(m, rapida, T0); // resetea
    expect(evaluarLectura(m, lenta(3), T0)).toEqual([]);
    expect(evaluarLectura(m, lenta(4), T0)).toEqual([]);
    const n = evaluarLectura(m, lenta(5), T0);
    expect(n[0]).toMatchObject({ clave: "latencia:A", severidad: "alta" });
  });

  test("mensajes reenviados de la cola no cuentan como latencia alta", () => {
    const m = crearMotor();
    const d = { casa_id: "A", timestamp: iso(T0), medicion: {}, _llegadaMs: T0 + 60000, reenviado_offline: true };
    let n = [];
    for (let i = 0; i < 5; i++) n = evaluarLectura(m, d, T0);
    expect(n.map((x) => x.clave)).toEqual(["cola:A"]);
  });

  test("mensajes perdidos por hueco de secuencia", () => {
    const n = evaluarLectura(crearMotor(), { casa_id: "A", seq: 10, perdidos_previos: 2, medicion: {} }, T0);
    expect(n[0]).toMatchObject({ clave: "perdidos:A", severidad: "media" });
  });
});

describe("dispositivos", () => {
  const docs = [
    { id: "3", casa_id: "A", nombre: "Alfa", timestamp: iso(T0 + 10000), medicion: { consumo_w: 900 }, _llegadaMs: T0 + 10500, intervalo_s: 5 },
    { id: "2", casa_id: "B", nombre: "Beta", timestamp: iso(T0 + 5000), medicion: { consumo_w: 5000 } },
    { id: "1", casa_id: "A", nombre: "Alfa", timestamp: iso(T0), medicion: { consumo_w: 800 } },
  ];
  const registro = [
    { id: "C", casa_id: "C", nombre: "Gama", ultimo_recibido_ts: iso(T0 - 600000), ultima_medicion: { consumo_w: 50 } },
    { id: "A", casa_id: "A", nombre: "Alfa", ultimo_recibido_ts: iso(T0 - 30000), ultimo_ts: iso(T0 - 30000), ultima_medicion: { consumo_w: 1 } },
  ];

  test("combina registro + lecturas en vivo; el registro mantiene a los que no reportan", () => {
    const g = agruparDispositivos(docs, registro);
    expect(g.map((d) => d.casa_id)).toEqual(["A", "B", "C"]); // ordenado por nombre
    const a = g.find((d) => d.casa_id === "A");
    expect(a.ultimo.id).toBe("3");                // la lectura en vivo pisa al registro
    expect(a.lecturas).toHaveLength(2);
    expect(a.ultimoVistoMs).toBe(T0 + 10500);      // hora de llegada
    expect(a.latencia.ultima.total).toBe(500);
    const c = g.find((d) => d.casa_id === "C");
    expect(c.ultimo.medicion.consumo_w).toBe(50);
    expect(g.find((d) => d.casa_id === "B").anomalias[0].tipo).toBe("PICO_CONSUMO");
  });

  test("aplicarConectividad + resumen", () => {
    const d = aplicarConectividad(agruparDispositivos(docs, registro), T0 + 16000);
    const est = Object.fromEntries(d.map((x) => [x.casa_id, x.conectividad.estado]));
    expect(est).toEqual({ A: "online", B: "retrasado", C: "offline" });
    expect(resumenFlota(d)).toEqual({ total: 3, online: 1, retrasado: 1, offline: 1, sinDatos: 0 });
  });

  test("estadoPuente", () => {
    expect(estadoPuente(null, T0).estado).toBe("desconocido");
    expect(estadoPuente({ estado: "offline" }, T0).estado).toBe("detenido");
    expect(estadoPuente({ estado: "online", heartbeat_ts: { toMillis: () => T0 - 5000 } }, T0).estado).toBe("online");
    expect(estadoPuente({ estado: "online", heartbeat_ts: { toMillis: () => T0 - 120000 } }, T0).estado).toBe("caido");
    expect(estadoPuente({ estado: "online", mqtt_conectado: false, heartbeat_local_ts: iso(T0) }, T0).estado).toBe("sin-broker");
  });

  test("configConectividad toma los valores del puente", () => {
    expect(configConectividad({ offline_factor: 4, offline_min_s: 30 })).toMatchObject({ offlineFactor: 4, offlineMinS: 30 });
    expect(configConectividad(null).offlineFactor).toBe(3);
  });

  test("estadoSimulador", () => {
    expect(estadoSimulador(null, T0)).toBe("desconocido");
    expect(estadoSimulador({ estado: "offline", evento: "SIMULADOR_DETENIDO" }, T0)).toBe("detenido");
    expect(estadoSimulador({ estado: "online", actualizado: iso(T0 - 200000) }, T0)).toBe("sin-heartbeat");
    expect(estadoSimulador({ estado: "online", actualizado: iso(T0 - 1000) }, T0)).toBe("online");
  });
});
