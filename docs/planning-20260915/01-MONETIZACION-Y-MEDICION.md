# 01 — Trial, compra y medición

Objetivo: convertir una experiencia musical útil en compras verificadas. Depende del acceso existente, no del EQ. Prioridad comercial máxima.

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

## 1B — Resolver la prueba ilimitada de tempo

Hecho: si el usuario no crea loops, los veinte usos no se consumen. Endurecer el EQ no cambia esa situación.

Propuesta para decidir al implementar: **prueba de Player Tools de siete días desde la primera transformación musical efectiva, o veinte loops, lo que ocurra primero**. Siete es un valor inicial propuesto, no una aprobación. Abrir el panel o descargar original no inicia el plazo. Mostrar antes de comenzar una frase clara; aviso de un loop restante se conserva y el plazo necesita información propia.

Ventaja: cubre speed, Keep Tone y FX sin cobrar cada movimiento. Coste: exige plazo persistente, migración y decisión de qué ocurre si vence durante el último loop. Recomiendo respetar la gracia ya concedida hasta que termine su sesión y bloquear nuevos usos; explicar esta excepción.

Alternativa: minutos de escucha transformada. Da una prueba proporcional al uso, pero necesita contabilizar play/pause, pestañas simultáneas y audio efectivo. No la elegiría como primera versión para un único desarrollador. Mantener sólo veinte loops es viable únicamente aceptando explícitamente tempo sin vencimiento mientras haya saldo.

Una cuota/reloj local no ofrece protección contra reinstalación o manipulación del perfil. Tratarlo como límite de producto, no como antifraude invulnerable. No construir un sistema antifraude enorme antes de vender.

Entrega concreta de esta subetapa: una regla de vencimiento elegida, copy traducido y migración que no reinicia cuota previa. Mientras no se elija, se puede completar 1A y compra; no declarar cerrado el trial completo.

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
