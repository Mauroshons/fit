# Cómo medir el sillín con BikeFit Lab

Manual de la pestaña **Cotas**. Sirve para registrar la posición exacta del
sillín y poder reproducirla después de cambiarlo, de cambiar la tija o de
desmontar la bici para viajar.

**Por qué hace falta:** cada sillín tiene distinto grosor de carcasa, distinta
longitud y distinto punto de apoyo. Montar el nuevo «a la misma altura de
raíles» deja la pelvis en otro sitio. Lo que se conserva entre sillines no es
el hardware, son las cotas respecto al eje de pedalier.

---

## 1. Antes de empezar

| Requisito | Por qué importa |
|---|---|
| Bici **nivelada**, en rodillo o apoyada en vertical | Una bici inclinada falsea todas las alturas |
| Cámara en **trípode**, perpendicular al plano de la bici | Es medición 2D: si la cámara está girada, las cotas se deforman |
| Objetivo a la **altura del pedalier** | Mirar desde arriba o desde abajo acorta las verticales |
| A **2–3 metros**, con la bici completa en cuadro | Más cerca deforma por perspectiva; más lejos pierde resolución |
| Fondo despejado y buena luz | Para distinguir el perfil del sillín al marcar |
| Longitud de biela **real** en *Configuración* | Es la referencia que calibra toda la escala |

> **Lo más importante para comparar dos sillines: no muevas la cámara ni el
> trípode entre las dos mediciones.** Si la cámara cambia de sitio, cambia la
> perspectiva y los deltas dejan de ser fiables aunque la escala se recalibre.

No importa en qué posición esté la biela. La biela gira en un plano paralelo al
de la cámara, así que su longitud proyectada es la misma en cualquier ángulo.
Elige la posición en la que el pedal se vea más despejado.

---

## 2. Congelar la imagen

1. Activa la cámara y encuadra la bici.
2. Ve a la pestaña **Cotas**.
3. Pulsa **Congelar imagen**. Aparece el aviso `IMAGEN CONGELADA` y el cursor
   pasa a cruz.

Mientras la imagen está congelada no se analiza la pose: el overlay pertenece
a los marcadores. Pulsa **Reanudar vídeo** para volver al análisis de ángulos.

---

## 3. Los cinco puntos

Se marcan en orden; la app va indicando cuál toca. El criterio importa menos
que **marcar siempre en el mismo sitio**: si comparas dos sillines, un punto
colocado con otro criterio inventa un cambio que no existe.

### 1 · Centro del pedalier
El eje alrededor del que giran las bielas. Suele quedar tapado por la biela y
el plato: usa como referencia el **centro del tornillo de la biela**, que cae
sobre el eje. Es el origen de todas las cotas, así que es el punto que más
conviene afinar.

### 2 · Eje del pedal
El centro del eje donde la biela se une al pedal. **Calibra la escala**: su
distancia al pedalier es la longitud de biela que declaraste.

### 3 · Punta del sillín
El extremo delantero, en el **borde superior** del sillín, no en el morro
inferior ni en la carcasa.

### 4 · Trasera del sillín
El **punto más alto de la parte trasera**, justo antes de que el sillín caiga.
Es el punto más difícil de repetir: elige una referencia física que puedas
reconocer en los dos sillines, como el borde superior de la zona ancha.

Con la punta y la trasera queda definido el plano de apoyo, y con él la
inclinación. Por eso se marcan los dos y no solo uno.

### 5 · Centro del manillar
La parte alta de la barra, junto a la potencia. Es **opcional**: sin él se
calculan las siete cotas del sillín, pero no la caída ni el alcance.

---

## 4. Afinar los puntos

A pantalla reducida, **un píxel que pinchas puede valer varios milímetros**. La
app te dice cuántos, debajo de las cotas. Para medir sillines eso no es
despreciable, así que:

- **Maximiza la ventana** antes de marcar: cuanto mayor sea el escenario, más
  fino es cada píxel.
- **Flechas del teclado** mueven el último punto colocado un píxel de imagen.
  Con **Shift**, cinco píxeles.
- **Deshacer punto** quita el último; **Limpiar** vacía todos.

Toca cualquier cota para desplegar su explicación.

---

## 5. Guardar la ficha

Escribe un nombre que identifique la configuración —el modelo de sillín va
mejor que «antes» o «prueba 1»— y pulsa **Guardar ficha**.

Las fichas persisten entre sesiones en el navegador, así que puedes medir hoy,
cambiar el sillín mañana y comparar. Se guardan las diez últimas.

> Son locales a ese navegador y ese dispositivo: no se sincronizan entre el
> iPad y el ordenador. Para conservarlas fuera, usa **Exportar JSON** en la
> pestaña *Informe*, que incluye las cotas y las fichas.

---

## 6. El flujo para cambiar de sillín

1. Con el sillín actual montado, marca los cinco puntos y guarda la ficha con
   su nombre.
2. **Sin mover la cámara**, cambia el sillín.
3. Pulsa **Limpiar** y vuelve a marcar los cinco puntos.
4. Selecciona la ficha anterior como referencia con su botón de radio.
5. Lee la tabla **Cambio respecto a…**: resalta lo que se movió más de 2 mm o
   medio grado. Por debajo de eso es ruido de marcado, no un cambio real.
6. Corrige, vuelve a medir y repite hasta que los deltas queden en verde.

### Qué tocar según el delta

| Cota que cambió | Qué significa | Cómo se corrige |
|---|---|---|
| **Altura de sillín** +X | El sillín quedó X mm más alto | Baja la tija X mm |
| **Retroceso de la punta** +X | Quedó X mm más atrás | Adelanta el sillín X mm en los raíles |
| **Inclinación** +X° | La punta quedó X° más arriba | Baja la punta con el basculante |
| **Altura de punta y trasera cambian distinto** | Cambió la inclinación, no solo la altura | Corrige primero la inclinación, luego la altura |
| **Caída al manillar** | Consecuencia del cambio de altura del sillín | No toques el cockpit hasta igualar el sillín |

### El detalle que más se falla

**El tubo del sillín no es vertical** (ronda los 73°). Subir la tija también
mueve el sillín hacia atrás: unos **3 mm de retroceso por cada 10 mm de
altura**. Así que al corregir la altura verás moverse el retroceso sin haber
tocado los raíles. Ajusta en este orden:

1. Inclinación
2. Altura
3. Retroceso (al final, porque los dos pasos anteriores lo alteran)

---

## 7. Confirmar con el cuerpo

Igualar las cotas devuelve el sillín a su sitio, pero lo que de verdad importa
es dónde acaba la pelvis. Un sillín con otra forma puede dejarte sentado más
adelante aunque las cotas coincidan.

Para cerrar el círculo: pulsa **Reanudar vídeo**, haz una medición de pedaleo
normal y compara la **extensión de rodilla** con la del informe anterior. Si
las cotas coinciden y la rodilla también, la posición está reproducida. Si las
cotas coinciden pero la rodilla cambió más de 2°, el sillín nuevo te está
sentando en otro punto y hay que ajustar la altura para compensar.

---

## 8. Límites de esta medición

- Es **2D sobre una foto**. Un giro de cámara de 10° cuesta varios milímetros.
- La precisión real la marca el tamaño en pantalla, no el cálculo. Compara
  siempre mediciones hechas con la misma ventana y la misma cámara.
- La «longitud marcada» no es la longitud de catálogo del sillín: es la
  separación entre los dos puntos que marcaste. Sirve como control: si cambia
  mucho entre dos mediciones del *mismo* sillín, es que marcaste en sitios
  distintos y el resto de cotas también estará desplazado.
- No sustituye a un fitter profesional ni es un diagnóstico médico.
