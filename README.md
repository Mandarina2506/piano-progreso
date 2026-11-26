# Piano Progreso v4.0

Aplicación web progresiva (PWA) para organizar partituras de piano, estudiar por fragmentos y registrar el progreso.

## Funciones

- **Biblioteca de partituras:** importar un PDF o varias imágenes JPG, PNG o WEBP.
- **Carpetas:** crear, renombrar y eliminar carpetas; filtrar la biblioteca; elegir una carpeta al importar; mover partituras entre carpetas.
- **Lector integrado:** visor de PDF e imágenes con navegación entre páginas.
- **Progreso por fragmentos:** cada obra comienza con una unidad por página. Se pueden añadir unidades para compases o secciones.
- **Cuatro niveles de dominio:** Pendiente (0%), Aprendiendo (25%), En práctica (60%) y Dominado (100%).
- **Objetivos por obra:** descripción, fecha objetivo y minutos semanales deseados.
- **Bitácora:** registrar la fecha, duración y observaciones de cada sesión.
- **Estadísticas:** progreso general, minutos de práctica, total de tiempo y gráfico de los últimos siete días.
- **Anotaciones sobre la partitura:** activar «Anotar página» y tocar/clicar en un punto de la página para guardar una nota anclada. Las notas se guardan por página y se pueden editar o eliminar.
- **Metrónomo:** tempo de 30 a 240 BPM, compases 2/4, 3/4, 4/4 y 6/8, acento en el primer pulso. El tempo se conserva individualmente para cada obra.
- **Calendario de estudio:** programar prácticas por fecha, asociarlas a una partitura o marcarlas como práctica libre, indicar duración y objetivo, marcar tareas como completadas y eliminarlas.
- **Objetivo semanal global:** definir un objetivo en minutos; el indicador suma las sesiones reales registradas dentro de la semana actual. Marcar una práctica del calendario como completada no agrega automáticamente una sesión a la bitácora.
- **Copias de seguridad:** exportar partituras y los archivos PDF/imágenes originales, carpetas, fragmentos, anotaciones, objetivos, sesiones, agenda y configuración semanal en un archivo JSON. Se puede restaurar desde ese archivo.
- **PWA:** instalable desde el navegador cuando está publicada mediante HTTPS.

## Cómo probarla en una computadora

1. Descomprimí `piano-progreso-v4.zip`.
2. Abrí la carpeta `piano-progreso` en Visual Studio Code (o abrí directamente la carpeta extraída si conserva ese nombre).
3. Iniciá un servidor local, por ejemplo:

   ```bash
   python -m http.server 8000
   ```

4. Abrí `http://localhost:8000`.

No requiere `npm install`: utiliza HTML, CSS y JavaScript sin proceso de compilación.

## Publicar una actualización en GitHub Pages

Si ya tenés el repositorio de Piano Progreso, no hace falta crear otro:

1. Descargá y extraé la versión nueva.
2. Copiá el contenido de esta carpeta sobre el contenido del proyecto local existente.
3. Conservá la carpeta `.git` del repositorio local. No la reemplaces ni la elimines.
4. Desde la terminal de VS Code, ejecutá:

   ```bash
   git add .
   git commit -m "Actualiza Piano Progreso a la version 4"
   git push
   ```

GitHub Pages publicará la actualización. La URL no cambia si mantenés el mismo repositorio.

## Actualización y conservación de datos existentes

La aplicación conserva el nombre de la base IndexedDB (`piano-progreso-db`) y los almacenes `scores` y `folders`. La versión 4 incrementa la versión de la base a 4 y agrega el almacén `planner`; no borra ni recrea los datos de partituras y carpetas. Los registros existentes reciben los campos nuevos de anotaciones y tempo con valores iniciales. El service worker utiliza una caché v4 para descargar los archivos nuevos y retirar la caché anterior.

**Antes de actualizar, es recomendable descargar una copia de seguridad desde la v3 si ya tenés muchas partituras cargadas.** Después de publicar v4, abrí la misma dirección web con el mismo navegador y dispositivo. No borres los datos del sitio ni el almacenamiento del navegador. No uses una URL distinta para probar la actualización si necesitás acceder a los datos existentes.

`localhost`, GitHub Pages y distintos navegadores mantienen almacenamientos separados. Los datos de la versión local no aparecen automáticamente en el sitio publicado.

## Copias de seguridad y restauración

1. Abrí la sección **Calendario de estudio** y buscá **Copias de seguridad**.
2. Pulsá **Descargar copia**. Se descarga un archivo `piano-progreso-copia-AAAA-MM-DD.json`.
3. Guardá ese archivo fuera del navegador, por ejemplo en una computadora, pendrive o almacenamiento en la nube.
4. Para recuperar los datos, pulsá **Restaurar copia** y elegí un JSON generado por Piano Progreso.
5. Confirmá la operación.

**Atención:** restaurar reemplaza todos los datos locales actuales (partituras, carpetas, agenda y ajustes) por el contenido del archivo elegido. No combina las dos bibliotecas. Antes de restaurar, descargá una copia de seguridad de los datos actuales si necesitás conservarlos. Los archivos de respaldo pueden ser grandes porque incluyen los PDF y las imágenes, no solo los registros.

## Usar el metrónomo

1. Abrí una partitura.
2. En el panel lateral, ajustá el BPM con el control de velocidad.
3. Elegí el compás: 2/4, 3/4, 4/4 o 6/8.
4. Pulsá **Iniciar** y luego **Detener** para pararlo.

El primer pulso de cada compás se reproduce con un tono más agudo. El navegador necesita permitir la reproducción de audio; el metrónomo se detiene al cerrar la partitura.

## Usar el calendario

1. En **Calendario de estudio**, elegí una fecha. Los controles laterales cambian el mes.
2. En el formulario, seleccioná una partitura o dejá «Práctica libre».
3. Indicá los minutos previstos y el objetivo de la sesión.
4. Pulsá **Programar práctica**. La sesión aparecerá en la agenda del día.
5. Marcá la casilla cuando termines o eliminá una actividad que ya no necesites.
6. En **Objetivo semanal**, definí cuántos minutos querés practicar. El progreso se calcula a partir de las sesiones que hayas registrado en la bitácora de cada partitura.

Las actividades programadas y las sesiones realizadas son datos distintos: completar una actividad del calendario no registra por sí solo el tiempo real practicado.

## Anotar directamente sobre una partitura

1. Abrí una obra y navegá hasta la página que querés marcar.
2. Pulsá **Anotar página**.
3. Tocá o hacé clic sobre el lugar de la hoja donde querés colocar la marca.
4. Escribí la indicación (por ejemplo, digitación, dinámica, tempo o compases difíciles).
5. La marca numerada se verá sobre la partitura. Debajo de la hoja aparecerá la lista de anotaciones de esa página; podés editar o eliminar cada una.

Las posiciones se guardan como porcentajes relativos al tamaño de la página para que la marca se mantenga ubicada al cambiar el tamaño de pantalla. El visor PDF alternativo del navegador (cuando PDF.js no está disponible) no permite anclar anotaciones con precisión; en ese caso, la función indica que no está disponible.

## Cómo se calcula el progreso

| Nivel | Valor |
|---|---:|
| Pendiente | 0% |
| Aprendiendo | 25% |
| En práctica | 60% |
| Dominado | 100% |

El porcentaje de una página es el promedio de sus fragmentos. El porcentaje de la obra es el promedio de todas las páginas. Es una estimación basada en el nivel seleccionado manualmente, no una evaluación automática de la interpretación.

## Dónde se guardan los datos y limitaciones

- Las partituras, sesiones, anotaciones, carpetas y agenda se almacenan localmente en IndexedDB dentro del navegador y dispositivo.
- No existe sincronización entre dispositivos ni una cuenta de usuario. Para mover los datos, usá el archivo de copia de seguridad.
- Para abrir PDF, la aplicación usa PDF.js desde CDN. La primera carga del lector PDF requiere conexión a Internet si la biblioteca no está cacheada.
- El audio del metrónomo depende de la compatibilidad del navegador con Web Audio API.
- El calendario es un planificador personal; no envía notificaciones ni recordatorios del sistema operativo.

## Estructura del proyecto

- `index.html`: pantallas, formularios, calendario y visor.
- `styles.css`: diseño adaptable y estética vintage.
- `app.js`: biblioteca, carpetas, fragmentos, bitácora, estadísticas y base IndexedDB.
- `enhancements.js`: copias de seguridad, metrónomo, agenda y anotaciones sobre la partitura.
- `manifest.webmanifest`: configuración de instalación.
- `service-worker.js`: caché de la PWA.
- `icon.svg`: ícono de la aplicación.
- `assets/`: fotografías usadas en la interfaz.
