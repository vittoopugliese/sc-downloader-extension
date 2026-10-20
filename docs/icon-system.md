# Iconos de la app

Todos los controles usan nombres semánticos:

```html
<sc-icon name="play"></sc-icon>
<sc-icon name="download" class="toolbar-icon"></sc-icon>
```

```js
button.append(SCIcons.create('download'));
button.innerHTML = SCIcons.html('download');
button.querySelector('sc-icon').setAttribute('name', 'pause');
```

El color se hereda de `color`. El tamaño base se define con `width` / `height` o `--icon-size`. **La escala global está en `ICON_SCALE = 0.8` en `scripts/icons-runtime.js`**: reduce todos los dibujos un 20%, incluso dentro de shadow roots y con tamaños CSS explícitos. Conserva las dimensiones de botones, las áreas de clic y las animaciones del elemento contenedor. El icono es decorativo; el botón conserva su etiqueta accesible y estados.

## Compilación y selección

- `scripts/icon-vectors.json`: catálogo completo de 712 vectores, solo para desarrollo.
- `scripts/icon-aliases.json`: asignación de nombres semánticos a vectores.
- `scripts/icon-include.json`: nombres adicionales que deben conservarse si se construyen concatenando fragmentos o provienen de datos externos.
- `scripts/icons-runtime.js`: componente, caché, estilos y helpers compartidos.
- `scripts/build-icons.cjs`: genera los archivos distribuidos.

```sh
npm run build:icons
node scripts/verify-icons.js
npm run test:e2e:icons
```

La compilación analiza los literales de los HTML y scripts de la lista de empaquetado. Conserva los nombres utilizados en marcado, ternarios, arrays, mapas y argumentos de helpers, además de `help` como fallback y los nombres declarados en `icon-include.json`. Es una selección conservadora: un nombre que también aparece como texto normal puede mantenerse aunque no se use como icono. No analiza el flujo de datos ni evalúa código. Los nombres construidos dinámicamente necesitan declararse en `icon-include.json`.

Solo se incluyen los vectores seleccionados y se deduplican los compartidos por varios nombres. El catálogo actual genera 91 vectores para 95 nombres: aproximadamente 43 KB de renderer frente a los 520 KB anteriores. Los nombres originales y codepoints no forman parte de la interfaz distribuida. Para usar otro vector, agregar un alias semántico, usarlo en la app y recompilar. Un nombre desconocido muestra `help`; `SCIcons.has(nombre)` permite comprobar disponibilidad.

Ambas rutas de empaquetado comprueban que los archivos generados estén actualizados y fallan con instrucciones de reconstrucción si no lo están. El catálogo completo, las herramientas de compilación y los SVG antiguos de compatibilidad quedan fuera del paquete. El favicon PNG conserva su entrada explícita.

## Carga

`popup.html`, `stems.html` y el mundo MAIN de SoundCloud cargan `scripts/icons.js`. Los scripts ISOLATED cargan `scripts/icons-client.js`, unos 1,9 KB con los helpers y nombres, sin geometría ni renderer. Las etiquetas que crean se dibujan mediante el registro compartido de Chrome.

No hay fuentes, peticiones de iconos ni observadores del documento. Cada vector se interpreta una vez y las siguientes instancias clonan su plantilla. Los elementos comparten una hoja de estilos. Cambiar a otro nombre del mismo vector conserva el dibujo. Las cargas repetidas salen inmediatamente.

`test-results/icons-catalog.png` muestra los nombres incluidos. Las pruebas verifican el filtrado, deduplicación, estados dinámicos, escala, color, visibilidad, shadow roots y registro real MAIN/ISOLATED.

Las carátulas, gráficos de audio, capturas promocionales e identidad de la extensión son recursos separados de los iconos de controles. El header del popup usa la imagen original `assets/icons/player-toolkit.png`.

Los alias `heart` y `bypass` comparten `custom:heart-bypass`: el corazón original recuperado del historial anterior a `2cc3c1a`, conservado también en `assets/icons/bypass.svg` (SVG Repo). El grupo interno conserva `fill="none"` y `stroke="currentColor"` para mantener el trazo y heredar el color de cada control. Se usa en el crédito, bypass general, EQ y FX de ambas superficies.

## Procedencia de desarrollo

Los vectores de `icon-vectors.json` provienen del inventario local de FL Studio 2025, documentado en `.fl-studio-icons/manifest.json`; la grilla original está en `.fl-studio-icons/index.html`. Los nombres neutros no cambian la procedencia. Se conservan los avisos de terceros del proyecto.
