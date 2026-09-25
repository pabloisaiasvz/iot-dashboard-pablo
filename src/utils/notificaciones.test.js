import {
  agregarNotificacion, contarNoLeidas, eliminarNotificacion, filtrarNotificaciones, marcarLeida,
  marcarTodasLeidas, sanearGuardadas,
} from "./notificaciones";

const T = 1_800_000_000_000;

describe("agregarNotificacion", () => {
  test("agrega al tope con id y no leída", () => {
    const { items, agrupada } = agregarNotificacion([], { titulo: "A", severidad: "alta" }, T);
    expect(agrupada).toBe(false);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ titulo: "A", severidad: "alta", leida: false, count: 1 });
    expect(typeof items[0].id).toBe("string");
  });

  test("misma clave dentro del cooldown → agrupa (×N) y sube al tope", () => {
    let r = agregarNotificacion([], { clave: "x", titulo: "X", mensaje: "1", severidad: "media" }, T);
    r = agregarNotificacion(r.items, { clave: "y", titulo: "Y" }, T + 1);
    r.items = marcarTodasLeidas(r.items);
    r = agregarNotificacion(r.items, { clave: "x", mensaje: "2", severidad: "alta" }, T + 1000, { cooldownMs: 60000 });
    expect(r.agrupada).toBe(true);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ clave: "x", count: 2, mensaje: "2", leida: false, severidad: "alta" });
  });

  test("la severidad agrupada nunca baja", () => {
    let r = agregarNotificacion([], { clave: "x", severidad: "critica" }, T);
    r = agregarNotificacion(r.items, { clave: "x", severidad: "info" }, T + 10);
    expect(r.items[0].severidad).toBe("critica");
  });

  test("fuera del cooldown crea una nueva", () => {
    let r = agregarNotificacion([], { clave: "x" }, T, { cooldownMs: 1000 });
    r = agregarNotificacion(r.items, { clave: "x" }, T + 5000, { cooldownMs: 1000 });
    expect(r.agrupada).toBe(false);
    expect(r.items).toHaveLength(2);
  });

  test("el cooldown por notificación tiene prioridad", () => {
    let r = agregarNotificacion([], { clave: "lat", cooldownMs: 300000 }, T, { cooldownMs: 1000 });
    r = agregarNotificacion(r.items, { clave: "lat", cooldownMs: 300000 }, T + 120000, { cooldownMs: 1000 });
    expect(r.agrupada).toBe(true);
  });

  test("respeta el máximo", () => {
    let items = [];
    for (let i = 0; i < 10; i++) items = agregarNotificacion(items, { titulo: `${i}` }, T + i, { max: 3 }).items;
    expect(items.map((n) => n.titulo)).toEqual(["9", "8", "7"]);
  });

  test("severidad desconocida → info", () => {
    expect(agregarNotificacion([], { severidad: "rara" }, T).items[0].severidad).toBe("info");
  });
});

describe("operaciones", () => {
  const base = [
    { id: "a", leida: false, severidad: "critica", tipo: "sistema", ts: T },
    { id: "b", leida: true, severidad: "info", tipo: "anomalia", ts: T },
    { id: "c", leida: false, severidad: "media", tipo: "conectividad", ts: T },
  ];
  test("leer, contar, eliminar", () => {
    expect(contarNoLeidas(base)).toBe(2);
    expect(contarNoLeidas(marcarLeida(base, "a"))).toBe(1);
    expect(contarNoLeidas(marcarTodasLeidas(base))).toBe(0);
    expect(eliminarNotificacion(base, "b").map((n) => n.id)).toEqual(["a", "c"]);
  });
  test("filtros", () => {
    expect(filtrarNotificaciones(base, "no-leidas").map((n) => n.id)).toEqual(["a", "c"]);
    expect(filtrarNotificaciones(base, "criticas").map((n) => n.id)).toEqual(["a"]);
    expect(filtrarNotificaciones(base, "conectividad").map((n) => n.id)).toEqual(["a", "c"]);
    expect(filtrarNotificaciones(base, "anomalias").map((n) => n.id)).toEqual(["b"]);
    expect(filtrarNotificaciones(base, "todas")).toHaveLength(3);
  });
  test("sanearGuardadas descarta basura de localStorage", () => {
    expect(sanearGuardadas("hola")).toEqual([]);
    expect(sanearGuardadas(null)).toEqual([]);
    const r = sanearGuardadas([{ id: "x", ts: T, severidad: "??" }, { nada: 1 }, null]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: "x", severidad: "info", ultimoTs: T, count: 1, leida: false });
  });
});
