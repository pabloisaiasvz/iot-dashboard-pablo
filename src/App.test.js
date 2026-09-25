import { act, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

// Firestore falso: cada ref lleva su nombre para devolver datos distintos
jest.mock("./firebase", () => ({ db: {} }));
jest.mock("firebase/firestore", () => {
  const listeners = [];
  const consultas = [];
  return {
    __listeners: listeners,
    __consultas: consultas,
    collection: (_db, nombre) => ({ nombre }),
    doc: (_db, ruta) => ({ ruta }),
    query: (ref) => ({ ...ref }),
    orderBy: () => null,
    limit: () => null,
    where: () => null,
    // Función común (no jest.fn): CRA usa resetMocks y borraría la implementación
    getDocs: async (q) => { consultas.push(q); return { docs: [] }; },
    onSnapshot: (ref, a, b, c) => {
      const cb = typeof a === "function" ? a : b;
      const err = typeof a === "function" ? b : c;
      listeners.push({ ref, cb, err });
      return () => {};
    },
  };
});

const firestore = jest.requireMock("firebase/firestore");
const ahora = Date.now();
const iso = (ms) => new Date(ms).toISOString();

const snapColeccion = (docs, fromCache = false) => ({
  metadata: { fromCache },
  docs: docs.map((d) => ({ id: d.id, data: () => d })),
  docChanges: () => [],
});
const snapDoc = (data) => ({ id: "x", exists: () => !!data, data: () => data });

function emitir() {
  act(() => {
    for (const { ref, cb } of firestore.__listeners) {
      if (ref.nombre === "telemetria") {
        cb(snapColeccion([
          { id: "t1", casa_id: "CASA_01", nombre: "Casa familiar grande", timestamp: iso(ahora - 1000),
            medicion: { consumo_w: 1500, tension_v: 221, factor_potencia: 0.95, frecuencia_hz: 50 }, intervalo_s: 5 },
          { id: "t2", casa_id: "CASA_02", nombre: "Departamento pequeño", timestamp: iso(ahora - 120000),
            medicion: { consumo_w: 600, tension_v: 219, factor_potencia: 0.9, frecuencia_hz: 50 }, intervalo_s: 5 },
        ]));
      } else if (ref.nombre === "dispositivos") {
        cb(snapColeccion([]));
      } else if (ref.ruta) {
        cb(snapDoc(null));
      }
    }
  });
}

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
beforeEach(() => {
  firestore.__listeners.length = 0;
  firestore.__consultas.length = 0;
  window.localStorage.clear();
});

test("muestra la pantalla de carga mientras conecta", () => {
  render(<App />);
  expect(screen.getByText(/CONECTANDO A FIREBASE/)).toBeInTheDocument();
});

test("lista dispositivos y marca offline al que dejó de reportar", () => {
  render(<App />);
  emitir();
  expect(screen.getAllByText("Casa familiar grande").length).toBeGreaterThan(0);
  expect(screen.getByText("Departamento pequeño")).toBeInTheDocument();
  expect(screen.getByText(/1 offline/)).toBeInTheDocument();
  expect(screen.getByText("1/2")).toBeInTheDocument();

  // Seleccionar el dispositivo offline muestra el aviso
  fireEvent.click(screen.getByText("Departamento pequeño"));
  expect(screen.getByText(/DISPOSITIVO OFFLINE/)).toBeInTheDocument();
});

test("la pestaña historial consulta Firestore", async () => {
  render(<App />);
  emitir();
  await act(async () => {
    fireEvent.click(screen.getByRole("tab", { name: /HISTORIAL/ }));
  });
  // Lecturas, alertas y eventos del dispositivo seleccionado
  expect(firestore.__consultas.map((q) => q.nombre).sort()).toEqual(["alertas", "eventos", "telemetria"]);
  expect(await screen.findByText(/No hay lecturas de CASA_01/)).toBeInTheDocument();
});

test("centro de notificaciones: abre, muestra el resumen inicial y marca leídas", () => {
  render(<App />);
  emitir();
  const campana = screen.getByRole("button", { name: /Notificaciones \(1 sin leer\)/ });
  fireEvent.click(campana);
  expect(screen.getByText(/1 dispositivo\(s\) sin datos/, { selector: ".notif-panel *" })).toBeInTheDocument();
  fireEvent.click(screen.getByText("Marcar leídas"));
  expect(screen.getByRole("button", { name: /Notificaciones \(0 sin leer\)/ })).toBeInTheDocument();
});
