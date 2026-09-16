# 01 — Trial, compra y medición

Objetivo: convertir una experiencia musical útil en compras verificadas. Depende del acceso existente, no del EQ. Prioridad comercial máxima.

## Estado de implementación al 15/09/2026

- **1A y 1B:** cerradas en código y navegador. Incluyen trial global de siete
  días, veinte loops, gracia final, carreras y enforcement de audio/export.
- **1C:** checkout, activación/recuperación idempotente, revalidación offline y
  revocación están conectados al mismo entitlement. El Worker valida origen,
  firma y producto; no concede Pro por una URL de success.
- **1D:** embudo mínimo integrado en extensión y servidor con ID seudónimo,
  allow-list de eventos/propiedades y compra confirmada desde webhook. La
  landing declara el alcance; no recibe analytics.
- **1E:** queda definido como trabajo experimental posterior; no se altera
  precio/cuota/oferta sin datos del embudo.

Verificación automatizada: `npm run test:player-tools`, `npm test`, popup,
tempo, loop y descarga E2E. Gate de release pendiente: desplegar infraestructura
con credenciales reales de test y reconciliar una compra/refund sandbox según
`services/player-tools-license/README.md`. Sin esas credenciales no es posible
certificar honestamente la transacción externa, aunque la etapa de código queda
lista para continuar con 02.

## Oferta de partida

Downloader original/colecciones: gratis. Player Tools: demostración limitada y Pro lifetime. Conservar los veinte loops globales, gracia del último loop y exportación Pro. No cambiar Likes Explorer.

Conservar provisionalmente la oferta explícita registrada: USD 3,69 lanzamiento y USD 6,79 de referencia futura. Centralizar importes en centavos, moneda, disponibilidad de checkout y copy; verificar coincidencia con el producto del proveedor. El precio de referencia no debe describirse como precio histórico de venta si nunca se cobró.

No recomiendo regalar reverb/delay para compensar el cierre de tempo. Primero medir el modelo coherente: probar la experiencia y comprar para conservarla; EQ es Pro desde el comienzo, incluso durante la prueba de otras herramientas.

## 1A — Terminar el acceso existente

Archivos: `scripts/player-tools-policy.js`, `player-tools-access.js`, `player-tools-client.js`, `tempo-control-main.js`, `looper.js`, `looper-main-bridge.js`, `background.js`. Leer el [contrato existente](../PLAYER-TOOLS-FOUNDATION-HANDOFF-20260913.md) al implementar.

1. Inventariar entradas de creación/edición de loops, presets, velocidad, Keep Tone, FX, teclado, bypass y exports; conectar todas a las mismas capacidades.
2. Preparar rango → autorizar → revalidar identidad/generación → aplicar. No consumir al abrir panel, mover slider, marcar sólo A ni arrastrar un loop ya concedido.
3. Deduplicar reintentos con request ID estable; no recrear contador en MAIN. Preservar cuota en actualizaciones y reinicio de worker.
4. UI loading/error/agotada refleja audio efectivo: sin permisos, rate neutro y FX fuera de señal; conservar preferencias para Pro. Al terminar gracia, colapsar looper y ofrecer acceso Pro sin atrapar el foco.
5. Preservar sesiones y gracia exactamente como define el handoff; nunca convertir `remaining=0` en corte instantáneo del loop 20.
6. Completar fixtures dev separados de release para 0/18/19/20/Pro, fallos de storage y cambios entre pestañas. No introducir una llave maestra de producción.

Cierre: probar 19→20, dos pestañas disputando último uso, Clear/cambio de track con permiso en vuelo, recarga, worker reiniciado, eventos viejos, Free agotado descargando originales y Pro exportando. Verificadores: `npm run test:player-tools`, `node scripts/verify-loop-background-routing.js`, `npm run test:e2e:tempo`, `npm run test:e2e`, y checklist de descargas.

## 1B — Prueba global de siete días

**Decisión confirmada el 15/09/2026:** Free recibe una prueba única de Player Tools de siete días. Comienza cuando la persona abre por primera vez el popup de descarga o Player Tools después de instalar o actualizar a la versión que incorpora esta oferta. Al vencer se bloquean todas las herramientas musicales: velocidad, Keep Tone, loops, presets y FX. Las descargas normales de tracks y colecciones permanecen gratis.

Los veinte loops siguen siendo un límite dentro de esos siete días: la prueba termina al vencer el plazo **o** al consumir el loop 20, lo que ocurra primero. La gracia ya concedida al propietario del loop 20 continúa hasta que termine esa sesión, incluso si el reloj vence mientras ese loop está activo; no permite crear otro loop ni exportar.

### Trabajo pendiente para implementar la decisión

1. Extender el registro durable de acceso con `trial.startedAt` y `trial.expiresAt`, con validación y revisión de schema. Los timestamps se guardan en milisegundos UTC y el cálculo de expiración se centraliza en `player-tools-policy.js`; MAIN nunca calcula ni escribe el reloj.
2. Iniciar la prueba de forma idempotente desde dos entradas runtime: primera apertura del popup y primera apertura de Player Tools. Ambas llaman al mismo comando del worker; abrir ambas superficies o reintentar tras timeout no cambia la fecha.
3. Migrar instalaciones existentes sin reiniciar `trial.used`, recibos ni Pro. Una instalación que ya tenía el trial anterior comienza sus siete días en la primera de esas aperturas posterior a la actualización; Pro no recibe ni necesita plazo. Datos corruptos o un storage inaccesible siguen fallando cerrados.
4. Hacer que snapshots y `canAuthorize` evalúen el vencimiento antes de conceder `set-rate`, `set-preserve-pitch`, `set-effect`, presets y nuevos loops. Mantener la concesión del loop 20 con la semántica de gracia existente.
5. Exponer estados y copy localizados: días restantes, último día, vencida y motivo del paywall. No iniciar el reloj por abrir una página de SoundCloud, mover un slider ni descargar un original sin abrir el popup.
6. Añadir fixtures de desarrollo para prueba no iniciada, día 1, último día, vencida, 19/20 loops, Pro, reinicio del worker y dos pestañas. Probar actualización de un registro v1, repetición de apertura y vencimiento durante la sesión final.

Una cuota/reloj local no ofrece protección contra reinstalación o manipulación del perfil. Tratarlo como límite de producto, no como antifraude invulnerable. No construir un sistema antifraude enorme antes de vender.

Condición de cierre: una instalación actualizada empieza una sola prueba de siete días al abrir popup o Player Tools; al vencer, los controles dejan de afectar el audio y muestran Pro, sin afectar descargas gratis ni borrar preferencias.

## 1C — Compra, activación y recuperación

Hay un servicio candidato en `services/player-tools-license/`. Verificar primero si otra rama/sesión ya lo integra. Reutilizar proveedor y contrato válidos; no asumir despliegue o credenciales por la presencia de código.

1. CTA Pro desde contexto preciso: EQ bloqueado, export, fin de prueba y promoción del downloader. Explicar beneficio y pago único.
2. Abrir checkout desde gesto explícito; estado pendiente y recuperación si se cierra la pestaña.
3. Confirmar compra en servidor mediante evento validado del proveedor; deduplicar pedido y webhook. Un regreso a una URL de “success” no concede Pro.
4. Activación en extensión y revalidación coherentes con el proveedor. Estados: pendiente, activa, error recuperable, revocada. Conservar identidad de compra fuera del puente MAIN.
5. Recuperar compra existente y mostrar soporte si falla; no forzar a pagar otra vez. Definir dispositivos/activaciones permitidos y comportamiento offline antes del lanzamiento.
6. Probar pago de prueba, cancelación, rechazo, webhook repetido/tardío, compra confirmada sin activación, restitución y revocación. No usar pagos reales para validar por defecto.

Cierre: una compra de prueba produce una única venta y habilita el mismo Pro que usan los controles; refund/revocación se refleja sin borrar preferencias. Si no hay checkout operativo, el CTA debe explicar disponibilidad y no simular una compra.

## 1D — Embudo mínimo, sin mezclar personas y eventos

Primero registrar un baseline de CWS y proveedor. La landing dice actualmente “no analytics”; cualquier incorporación debe acompañarse con declaración actualizada y tratamiento de privacidad correspondiente. El diseño propone datos mínimos y sin bibliotecas musicales, títulos, URLs de tracks, emails ni licencias en eventos analíticos.

| Evento propuesto | Cuándo cuenta | Propiedad mínima útil |
| --- | --- | --- |
| `player_tools_promo_seen` | Promoción efectivamente visible, una vez por sesión/superficie | versión, superficie, locale |
| `player_tools_opened` | Panel montado y visible | plan, estado de prueba, origen |
| `player_tools_value_reached` | Primera transformación aplicada con éxito | categoría, no parámetros musicales |
| `pro_feature_attempted` | Intento válido de capacidad exclusiva | EQ/export/preset, según oferta final |
| `paywall_seen` | Explicación Pro visible | causa, versión de oferta |
| `checkout_started` | Checkout creado y abierto correctamente | experimento/oferta, correlación acotada |
| `purchase_confirmed` | Confirmación validada en servidor | pedido deduplicado, importe/moneda |
| `license_activated` | Cliente recibió entitlement activo | versión, resultado |
| `download_job_completed` | Trabajo terminal con archivos guardados | tipo, cantidad agregada, resultado |

Evento de instalación sólo en instalación nueva, separado de actualización. “Activo” debe definirse, por ejemplo una acción exitosa en siete días; no equivaler a proceso abierto. Si la recogida es opcional, reportar cobertura: una cohorte medible no representa necesariamente toda la base.

La ruta no es un único embudo lineal: alguien puede comprar desde la promoción sin intentar una función Pro. Comparar recorridos por origen sin excluir esas compras. Usar usuarios/instalaciones seudónimas únicas por cohorte donde sea viable, no dividir eventos repetidos por visitas únicas.

Retención D1/D7 por cohorte de activación; conversión compra/apertura en ventana fija, por ejemplo 14 días. Compras también deben medirse desde el servidor para no perder las que ocurren con popup cerrado. El identificador analítico no es una licencia y no debe conceder acceso.

No unir automáticamente la identidad del visitante de CWS con una instalación: atribución de Store, landing y extensión tiene límites. UTMs ayudan a comparar campañas; no garantizan un enlace individual extremo a extremo. Desinstalaciones: empezar por datos agregados de Store y formulario voluntario ya existente, sin inventar un evento infalible al desinstalar.

## 1E — Experimentos de ingresos

Orden: acceso funcional → explicación contextual → activación fiable → beneficio/presentación → precio. Una variable comercial por prueba.

Hipótesis inicial de la conversación: 1–3% de compradores entre usuarios que abren Player Tools. Es objetivo de exploración, no benchmark validado. Reportar numerador, denominador y tiempo de observación; no declarar ganador con cinco compradores.

Precio 2,99/4,99/7,99–9,99 queda como antecedente para comparar más adelante. La oferta fundadora puede acabar en una fecha real o volumen real definido, nunca con contador ficticio. Mantener derechos de quienes ya compraron.

Medida principal: ingreso neto de nuevos compradores por 1.000 usuarios elegibles de la cohorte. Acompañar con activaciones exitosas, devoluciones, soporte, retención y desinstalaciones. Una subida que produce más ingreso bruto y muchos reembolsos no queda validada.

En el primer lanzamiento preparar recibos de medición y errores recuperables; no bloquear toda publicación esperando un dashboard sofisticado.
