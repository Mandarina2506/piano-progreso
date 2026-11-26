# Piano Progreso · Versión 3

Aplicación web móvil instalable (PWA) para organizar partituras de piano y registrar el progreso de estudio. Esta versión mantiene la base de datos local de la versión anterior y suma seguimiento por fragmentos, objetivos, sesiones y estadísticas.

## Novedades de la versión 3

- **Estética vintage:** piano oscuro, tonos sepia, papel cálido y detalles rojo vino. Incluye las dos imágenes de referencia compartidas.
- **Biblioteca de partituras:** importar un PDF o varias imágenes JPG, PNG o WEBP.
- **Carpetas:** crear, renombrar y eliminar carpetas; filtrar la biblioteca por carpeta; elegir una carpeta al importar; mover partituras entre carpetas. Al eliminar una carpeta, sus partituras pasan a «Sin carpeta» sin perder archivos, progreso, objetivos, apuntes ni sesiones.
- **Lector integrado:** visor de PDF e imágenes con navegación entre páginas.
- **Progreso por fragmentos:** cada obra comienza con una unidad por página. Se pueden añadir unidades para compases o secciones más pequeñas.
- **Cuatro niveles de dominio:** Pendiente (0%), Aprendiendo (25%), En práctica (60%) y Dominado (100%).
- **Cálculo del progreso:** calcula primero el promedio de fragmentos de cada página y luego promedia las páginas, para que una página dividida en más partes no pese más que otra.
- **Objetivos personales:** descripción de la meta, fecha objetivo y minutos semanales deseados.
- **Bitácora de práctica:** fecha, duración y breve descripción de cada sesión.
- **Estadísticas:** progreso general, minutos de la semana, total de tiempo y gráfico de los últimos siete días.
- **Apuntes por obra:** notas de digitación, tempo, dinámica y pasajes difíciles.
- **Guardado local:** los datos se guardan en IndexedDB dentro del navegador y dispositivo.
- **PWA:** se puede instalar desde el navegador cuando está publicada en HTTPS.

## Cómo probarla en una computadora

1. Descargá y descomprimí `piano-progreso-v3.zip`.
2. Abrí la carpeta `piano-progreso` desde Visual Studio Code.
3. Iniciá un servidor local. Por ejemplo, abrí una terminal en la carpeta y ejecutá:

   ```bash
   python -m http.server 8000
   ```

4. Abrí `http://localhost:8000` en el navegador.

También podés usar la extensión Live Server de VS Code. No necesita `npm install`: usa HTML, CSS y JavaScript sin proceso de compilación.

## Publicar una actualización en GitHub Pages

Si ya tenés el repositorio de la versión 1, reemplazá sus archivos por el contenido de esta carpeta, conservando también la carpeta `assets` completa. Desde la terminal de VS Code, ejecutá:

```bash
 git add .
 git commit -m "Actualiza Piano Progreso a la version 3"
 git push
```

GitHub Pages volverá a publicar el sitio después de unos instantes. No crees un repositorio nuevo si querés seguir usando la misma dirección web.

Si todavía no activaste Pages: en GitHub abrí **Settings → Pages**, elegí **Deploy from a branch**, seleccioná `main` y la carpeta `/(root)`, y guardá.

## Instalarla en el celular

1. Abrí la dirección HTTPS de GitHub Pages desde el celular.
2. En Android, abrí el menú de Chrome y elegí **Instalar aplicación** o **Agregar a pantalla de inicio**.
3. En iPhone, abrí el sitio en Safari, tocá **Compartir** y elegí **Agregar a pantalla de inicio**.

## Cómo se calcula el progreso

Cada fragmento tiene un nivel:

| Nivel | Valor de progreso |
|---|---:|
| Pendiente | 0% |
| Aprendiendo | 25% |
| En práctica | 60% |
| Dominado | 100% |

El porcentaje de cada página es el promedio de sus fragmentos. El porcentaje de la obra es el promedio de todas sus páginas. Ejemplo: si una página tiene dos fragmentos, uno Dominado (100%) y otro En práctica (60%), el avance de esa página es 80%. Es una estimación basada en el nivel que vos seleccionás: la aplicación no escucha ni evalúa automáticamente cómo tocás el piano.

Al cargar una obra se crea una unidad inicial por página. Cuando agregás el primer fragmento manual en una página, la unidad general pendiente de esa página se reemplaza automáticamente. Después podés añadir más compases o secciones para esa misma página.

## Cómo registrar una sesión

Dentro de una partitura, completá la fecha, duración en minutos y una nota opcional sobre lo que trabajaste. El registro aparece en las sesiones recientes y suma al gráfico semanal.

## Dónde se guardan los datos y qué pasa con la versión anterior

La aplicación conserva el mismo nombre de base IndexedDB (`piano-progreso-db`) y el mismo almacén de partituras. La versión 3 actualiza la base a la versión 3 y agrega un almacén separado para carpetas; no elimina ni recrea las partituras existentes. La versión 2 agrega los nuevos campos al leer los registros existentes: las páginas que estaban marcadas como aprendidas se convierten en unidades con estado **Dominado** y las demás quedan **Pendiente**.

Para conservar tus datos, actualizá los archivos en el mismo sitio/dirección y usá el mismo navegador y dispositivo. No borres los datos del sitio ni el almacenamiento del navegador. Los datos no se sincronizan entre distintos dispositivos ni se envían a un servidor. Hacé copias de seguridad de tus archivos originales de partituras.

**Atención:** `localhost`, GitHub Pages y distintos navegadores tienen almacenamientos separados. Los datos cargados mientras probabas en `localhost` no aparecen automáticamente en la versión publicada.

## Nota sobre los PDF y uso sin conexión

El visor utiliza PDF.js desde CDN y necesita conexión a Internet para cargar esa biblioteca. La aplicación y sus imágenes de interfaz se cachean para el uso como PWA, pero la primera carga de PDF puede requerir conexión.

## Estructura del proyecto

- `index.html`: pantallas, formularios y visor.
- `styles.css`: diseño adaptable y estética vintage.
- `app.js`: importación, biblioteca, carpetas, fragmentos, objetivos, sesiones, estadísticas y almacenamiento.
- `manifest.webmanifest`: configuración de instalación.
- `service-worker.js`: caché de la aplicación.
- `icon.svg`: ícono.
- `assets/`: fotografías de piano utilizadas en la interfaz.


## Cómo usar las carpetas

1. En **Mis partituras**, pulsá **Organizar carpetas**.
2. Escribí un nombre (por ejemplo: Chopin, Estudios, Repertorio actual o En aprendizaje) y creá la carpeta.
3. Usá las pestañas para filtrar la biblioteca por carpeta.
4. Al agregar una partitura, elegí dónde guardarla en **Guardar en carpeta**.
5. Para mover una obra existente, utilizá el selector **Mover a** de su tarjeta.
6. Para renombrar una carpeta, editá su nombre y presioná **Guardar**.
7. Al eliminar una carpeta, las partituras se conservan y pasan a **Sin carpeta**.

Las carpetas y su asignación se almacenan en IndexedDB en el mismo dispositivo y navegador que el resto de los datos.
