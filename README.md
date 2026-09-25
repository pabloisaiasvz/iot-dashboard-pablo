# IoT Energy Monitor — Dashboard

Dashboard en React que lee de Firestore en tiempo real los datos que guarda el
puente `subscriber_firebase.py` (repo `IoT-simulator`).

## Funcionalidades

- **En vivo:** gauges, métricas y gráficos del dispositivo seleccionado.
- **Estado online / retrasado / offline** por dispositivo, según cuánto hace que no llegan datos
  (`max(3 × intervalo, 15 s)`, o los valores que publique el puente en `sistema/puente`).
  Los dispositivos que dejan de reportar siguen en la lista gracias a la colección `dispositivos`.
- **Latencia** por etapa (cola del dispositivo, red MQTT, escritura en Firestore, entrega al
  navegador), promedio / p95 / máximo, y RTT del puente al broker.
- **Notificaciones:** campana con centro de notificaciones (filtros, marcar leídas, limpiar),
  avisos emergentes, sonido y notificaciones del navegador opcionales. Avisa de dispositivos
  offline/online, anomalías eléctricas, eventos de red, latencia alta, mensajes perdidos y caídas
  del puente / simulador / Firestore. Se agrupan (×N) para no inundar y se guardan en `localStorage`.
- **Historial por dispositivo:** rangos 15 min – 7 días o personalizado, disponibilidad, energía
  (kWh), estadísticas, gráficos con los cortes sombreados, períodos sin datos, eventos y alertas,
  tabla paginada y exportación a CSV.

## Configuración de Firestore

1. **Índices compuestos** (necesarios para el historial): están en `firestore.indexes.json`.
   ```bash
   npx firebase-tools deploy --only firestore:indexes --project iot-energy-monitor-cb06d
   ```
   También se pueden crear desde el link que muestra el dashboard si falta alguno.
2. **Reglas:** el dashboard lee `telemetria`, `dispositivos`, `alertas`, `eventos` y `sistema`.
   Si alguna colección no es legible, el dashboard sigue funcionando pero sin esa parte.

Umbrales y tiempos se ajustan en `src/config.js`.

## Estructura

```
src/
  App.js                  orquesta datos, estado y notificaciones
  config.js               umbrales, tiempos y límites
  firebase.js             inicialización de Firebase
  hooks/                  useFirestore, useHistorial, useNotificaciones, useAhora
  utils/                  lógica pura y testeada (telemetría, dispositivos, notificaciones)
  components/             VistaEnVivo, HistorialDispositivo, PanelLatencia, Notificaciones, Indicadores
```

## Tests

```bash
npm test
```

---

# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)
