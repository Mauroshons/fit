# BikeFit Lab

Aplicativo web para hacer un **bikefit de bicicleta de ruta** usando la cámara del
dispositivo. Detecta la pose del ciclista en tiempo real, segmenta las pedaladas,
mide los ángulos articulares clave y emite recomendaciones de ajuste.

Todo corre **en el navegador**: el vídeo nunca sale del dispositivo.

**▶ Abrir la app: <https://mauroshons.github.io/fit/>**

## Manuales

- **[Cómo medir el sillín](MANUAL-SILLIN.md)** — paso a paso de la pestaña *Cotas*:
  preparación, los cinco puntos, y el flujo completo para reproducir la posición
  al cambiar de sillín, de tija o tras desmontar la bici.

## Arrancar

```bash
node server.mjs
```

Luego abre `http://localhost:5173`. El servidor es necesario porque los
navegadores solo dan acceso a la cámara en contexto seguro (`localhost` o `https`).
La primera carga descarga el modelo de pose desde el CDN (~10 MB) y lo cachea.

Para usarlo desde el móvil en la misma red hace falta HTTPS (p. ej. un túnel tipo
`cloudflared` o `ngrok` apuntando al puerto 5173).

Para ver el formato del informe sin montar la bici en el rodillo:
`http://localhost:5173/?demo=1`

## Publicar en GitHub Pages

El sitio es estático y usa solo rutas relativas, así que funciona tal cual bajo
el subdirectorio `https://<usuario>.github.io/<repo>/`. No hace falta ni build
ni GitHub Actions: basta servir la rama desde la raíz.

Publicado en <https://mauroshons.github.io/fit/> desde el repositorio
[`Mauroshons/fit`](https://github.com/Mauroshons/fit).

Para replicarlo desde cero:

1. Crea un repositorio vacío en GitHub, **sin** README ni `.gitignore`
   (este repo ya los trae).
2. Conéctalo y súbelo:

```bash
git -C C:\Users\maber\Claude\bikefit remote add origin https://github.com/Mauroshons/fit.git
```

```bash
git -C C:\Users\maber\Claude\bikefit push -u origin main
```

3. En GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)`** y guarda.
4. En uno o dos minutos el sitio queda servido con HTTPS.

El `.nojekyll` evita que Pages procese el sitio con Jekyll.

### Uso desde iPhone y iPad

- **HTTPS es obligatorio**: Safari no ofrece la cámara sin contexto seguro, y
  desde el iPad no puedes usar `localhost`. GitHub Pages ya da HTTPS.
- La primera visita descarga el modelo desde el CDN de Google. En iPhone se
  elige automáticamente el modelo **ligero**; en iPad, el **estándar**. Puedes
  forzarlo con `?model=lite|full|heavy` o desde *Configuración*.
- Si WebKit no inicializa la GPU, la app reintenta por **CPU** y lo indica en la
  etiqueta de estado (irá más lenta, pero funciona).
- Usa el iPad **apaisado** y en horizontal respecto a la bici. Safari pedirá
  permiso de cámara la primera vez; si lo deniegas, se cambia en
  *Ajustes → Safari → Cámara* o en el icono «aA» de la barra de direcciones.

## Si la cámara no abre

La app muestra ahora un panel de diagnóstico con la causa exacta. Las tres
causas habituales:

| Síntoma en el panel | Causa | Solución |
|---|---|---|
| `contexto seguro: NO`, `protocolo: file:` | Abriste `index.html` haciendo doble clic | Arranca `node server.mjs` y entra por `http://localhost:5173` |
| `NotAllowedError`, `permiso de cámara: denied` | Permiso bloqueado para el sitio | Candado de la barra de direcciones → permitir cámara → recargar |
| `dentro de iframe: SÍ` | Página incrustada en un panel de vista previa | Ábrela en una pestaña normal del navegador |

Otros casos que el panel distingue: `NotReadableError` (la cámara la tiene
ocupada Teams/Zoom/Meet), `NotFoundError` (no hay webcam conectada) y
`OverconstrainedError` (la cámara no admite la resolución pedida; elige otra en
el selector).

## Qué mide

**Vista lateral (sagital)** — la medición principal:

| Métrica | Qué es | Rango de referencia |
|---|---|---|
| Extensión de rodilla (PMI) | Pierna más estirada del ciclo | 140–148° |
| Flexión de rodilla (PMS) | Pierna más recogida | 68–78° |
| Ángulo de cadera (mín.) | Apertura torso-muslo | 38–58° según perfil |
| Inclinación de torso | Respecto a la horizontal | 32–58° según perfil |
| Ángulo de codo | Flexión del brazo | 145–170° según perfil |
| Ángulo de hombro | Tronco-brazo | 78–100° según perfil |
| Tobillo en PMI / recorrido | Flexión plantar y ROM | 95–118° / 12–32° |
| KOPS | Rodilla vs eje de pedal con biela horizontal | −15 a +15 mm |

**Vista frontal** — complemento: desviación lateral de cada rodilla (valgo/varo),
desnivel de caderas y de hombros.

**Cotas de la bici** (pestaña *Cotas*) — mide el hardware, no el cuerpo. Sobre un
fotograma congelado se marcan cinco puntos (pedalier, eje del pedal, punta y
trasera del sillín, centro del manillar) y se obtienen:

| Cota | Para qué |
|---|---|
| Altura de sillín | La que replicas con cinta métrica al montar otro sillín |
| Altura de punta y de trasera | Juntas definen el plano de apoyo sin ambigüedad |
| Retroceso de punta y de trasera | Posición horizontal respecto al pedalier |
| Inclinación del sillín | Grados respecto a la horizontal; + = punta arriba |
| Caída y alcance al manillar | Relación sillín–cockpit |

La escala se calibra marcando el eje del pedal: su distancia al pedalier es la
longitud de biela, esté la biela en la posición que esté.

Las mediciones se guardan como **fichas** con nombre, persisten entre sesiones y
se comparan contra una de referencia, resaltando lo que cambió más de 2 mm o
medio grado. Ese es el flujo para cambiar de sillín: mides el actual, lo guardas,
montas el nuevo, vuelves a medir y ves exactamente cuánto se movió la posición.

## Cómo funciona

- `js/analyzer.js` — extrae métricas por frame y segmenta los ciclos de pedaleo
  siguiendo la **fase angular del tobillo** alrededor del centro de su trayectoria.
  De cada ciclo saca extensión/flexión máxima, KOPS en biela adelantada y medianas.
- `js/fitrules.js` — compara contra los rangos del perfil elegido
  (gran fondo / endurance / competición) y genera recomendaciones priorizadas,
  con estimaciones en milímetros.
- `js/geometry.js` — ángulos 2D, suavizado exponencial y estadística.
- `js/app.js` — cámara, bucle de inferencia, overlay y UI.

La escala px→mm se autocalibra: la trayectoria vertical del tobillo mide
aproximadamente el doble de la longitud de biela declarada.

## Protocolo de captura

1. Bici en rodillo, nivelada. Cámara en trípode a la altura del pedalier.
2. Plano perpendicular al eje de la bici, a 2–3 m, ciclista completo en cuadro.
3. Ropa ajustada, buena luz, sin contraluz.
4. Calentar 5 min, mantener 85–95 rpm, mirada al frente.
5. *Iniciar medición* y pedalear natural ≥ 12 pedaladas.

## Limitaciones conocidas

- Medición **2D**: cualquier desviación del plano perpendicular introduce error.
  Un giro de cámara de 10° puede costar varios grados en los ángulos.
- Los landmarks son del **centro articular estimado** por la red, no marcadores
  físicos: hay ±2–4° de ruido inherente.
- Las conversiones a milímetros son estimaciones (sensibilidades típicas:
  1° de rodilla ≈ 2,5 mm de tija; 1° de codo ≈ 2 mm de alcance).
- No sustituye a un fitter profesional ni es un diagnóstico médico.

## Siguientes pasos previstos

- Grabar el vídeo y permitir análisis cuadro a cuadro con scrubbing.
- Modo comparativa antes/después y persistencia de sesiones.
- Calibración con marcador físico de tamaño conocido.
- Detección de balanceo pélvico y dismetrías sobre varias pedaladas.
- Informe PDF con capturas de los puntos muertos.
