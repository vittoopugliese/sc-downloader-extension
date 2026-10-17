# Iconos de la app

Todos los controles usan el mismo elemento y los vectores del catálogo de FL Studio:

```html
<sc-icon name="play"></sc-icon>
<sc-icon name="download" class="toolbar-icon"></sc-icon>
```

```js
button.append(SCIcons.create('download'));
button.innerHTML = SCIcons.html('download');
button.querySelector('sc-icon').setAttribute('name', 'pause');
```

El nombre es el único dato obligatorio. El tamaño se define con CSS (`width` / `height` o `--icon-size`) y el color con `color`. El elemento es decorativo y no recibe foco ni clics; el botón conserva su `aria-label`, tooltip y estado `disabled` / `aria-pressed`. `hidden` funciona incluso si otra regla cambia `display`.

## Catálogo y mantenimiento

- `scripts/icon-aliases.json`: nombres de acciones, con una única asignación por nombre.
- `scripts/icons-runtime.js`: implementación del elemento y sus helpers.
- `scripts/icons.js`: archivo generado, incluido en el paquete. No editar directamente.
- `.fl-studio-icons/index.html`: grilla original para explorar los candidatos.
- `test-results/icons-catalog.png`: vista de los nombres de acciones generada por la prueba de navegador.

También están disponibles los 712 vectores originales: 616 glifos, 45 logos y 51 cursores. Se pueden pedir por familia y codepoint (`glyph:F020`, `logo:F027`, `cursor:0041`) o por su nombre original (`glyph:PR_pencil`, `logo:SoundCloud`). Los nombres distinguen mayúsculas. Para uso en controles, agregar un alias descriptivo en el JSON. Un nombre inexistente muestra `help`; `SCIcons.has(nombre)` permite validarlo.

Después de cambiar una asignación:

```sh
npm run build:icons
npm run test:e2e:icons
```

La compilación local lee los SVG de `.fl-studio-icons` y su manifest. También actualiza los SVG antiguos de `assets/icons` para conservar compatibilidad y el cursor de corte en `assets/icon-cursors.css`. La app ya no carga esos SVG antiguos para dibujar controles.

## Carga y rendimiento

El catálogo funciona sin fuentes, peticiones de iconos, observadores del documento ni búsquedas repetidas de nodos. Cada vector se interpreta al utilizarlo por primera vez; las siguientes instancias clonan su plantilla. Los elementos comparten una sola hoja de estilos. Cambiar a un nombre que resuelve al mismo vector no reconstruye el dibujo. La carga repetida del script sale inmediatamente.

`popup.html` y `stems.html` cargan el script antes de sus consumidores. En SoundCloud se registra en MAIN a `document_start`, también en los frames que usa el looper. Los scripts aislados tienen los mismos helpers y crean etiquetas que utiliza el registro compartido de Chrome. No necesitan puentes de URLs ni recursos web accesibles para los iconos.

Se migraron popup, Likes Explorer, reproductor/listening, looper, sampler, EQ, recorder, playlist, channel rack, piano roll, navegador de samples, menús y ventanas. Los gráficos de audio, carátulas, capturas promocionales y la identidad de la extensión siguen siendo sus propios recursos: son contenido y gráficos, no iconos de controles.

Origen de los vectores: inventario local de FL Studio 2025 en `.fl-studio-icons/manifest.json`. Los alias no cambian la procedencia de los recursos.
