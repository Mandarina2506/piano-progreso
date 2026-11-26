# Piano Progreso

Aplicación web móvil instalable para organizar partituras de piano y registrar el avance por páginas.

## Funciones incluidas

- Importar una partitura en PDF o cargar varias imágenes (JPG, PNG o WEBP) como páginas.
- Biblioteca con búsqueda por título o compositor.
- Visor de PDF e imágenes con navegación entre páginas.
- Marcar cada página como aprendida o volver a dejarla pendiente.
- Porcentaje de progreso por pieza y resumen general de toda la biblioteca.
- Apuntes de estudio por partitura.
- Guardado local en el dispositivo mediante IndexedDB.
- Diseño adaptable a teléfonos, tablets y computadoras.
- Base instalable como PWA cuando se sirve desde HTTPS o localhost.

## Cómo probarla en una computadora

1. Descargá y descomprimí `piano-progreso.zip`.
2. Abrí la carpeta del proyecto en Visual Studio Code.
3. Instalá la extensión **Live Server** o usá un servidor local.
4. Con Live Server, hacé clic derecho en `index.html` y elegí **Open with Live Server**.
5. También podés abrir una terminal en la carpeta y ejecutar:

   ```bash
   python -m http.server 8000
   ```

6. Abrí `http://localhost:8000` en el navegador.

No necesita `npm install`: esta primera versión usa HTML, CSS y JavaScript sin un proceso de compilación.

## Cómo instalarla en el celular

La instalación como aplicación requiere que el proyecto esté publicado en una dirección HTTPS. Una opción sencilla es publicarlo en GitHub Pages:

1. Creá un repositorio en GitHub y subí el contenido de esta carpeta.
2. En el repositorio, entrá en **Settings → Pages**.
3. En **Build and deployment**, seleccioná la rama principal y la carpeta raíz (`/root`).
4. Abrí desde el celular la dirección HTTPS que GitHub Pages te proporcione.
5. **Android:** en Chrome, abrí el menú y elegí **Instalar aplicación** o **Agregar a pantalla principal**.
6. **iPhone:** abrí la página con Safari, tocá **Compartir** y elegí **Agregar a pantalla de inicio**.

## Cómo se calcula el progreso

Cada página representa una unidad de avance. Por ejemplo, si una partitura tiene 8 páginas y marcaste 3 como aprendidas, el progreso será:

`3 / 8 × 100 = 37,5 %`, que se muestra redondeado como **38 %**.

El porcentaje general se calcula sumando todas las páginas completadas y dividiéndolas por el total de páginas de todas las partituras.

## Dónde se guardan los datos

Las partituras y el progreso se guardan en IndexedDB, dentro del navegador y del dispositivo donde se cargaron. No se envían a un servidor. Por eso, los datos no se sincronizan automáticamente entre el teléfono y la computadora. No borres los datos del navegador ni desinstales/limpies el almacenamiento del sitio sin hacer antes una copia de los archivos originales.

## Nota sobre los PDF

El visor utiliza PDF.js desde CDN para mostrar los PDF dentro de la aplicación y detectar sus páginas. Para esa función se necesita conexión a Internet al cargar el lector. Las imágenes guardadas pueden seguir consultándose desde el almacenamiento del dispositivo, una vez que la aplicación haya sido cargada.

## Estructura

- `index.html`: estructura de pantallas y formularios.
- `styles.css`: diseño adaptable a móvil.
- `app.js`: biblioteca, importación, visor, progreso y almacenamiento local.
- `manifest.webmanifest`: configuración de instalación PWA.
- `service-worker.js`: caché de los archivos principales de la aplicación.
- `icon.svg`: ícono de la aplicación.
