# Registro histórico de la revisión del 23/09/2026

**SUPERADO para continuidad.** La entrada vigente es [Estado actual del 24/09](../ESTADO-ACTUAL-20260924.md) y el checklist operativo es [10](10-CIERRE-RELEASE-Y-FREE-PRO-20260921.md). Este documento no está marcado como proyecto completado: sus pendientes fueron trasladados a esos registros.

## Evidencia histórica que se conserva

- Base `73fceb8`, cambios documentados en `6fe3dca`.
- Corrección de M17: descuento/precio futuro retirados; trial por perfil comunicado; canonical, robots y sitemap alineados a `sctd.vpugliese.online`.
- Gate local y navegador completados entonces; Likes incorporado a `test:release-local`.
- ZIP diagnóstico Test Mode con clave de fixture `test-p256-1`, SHA-256 `1d726e80321979d431de56ebd43723ed24f8157936b0f7180a3737b4500cab96`. No es candidato comercial ni evidencia de los bytes de HEAD actual.
- D1 test/producción creadas y seis migraciones aplicadas según el registro de esa sesión; pares ES256 separados y configuración sin secretos.

## Cambios posteriores que invalidan la continuación antigua

`670d4ee` completó el flujo automático de Lemon en Test Mode, configuró IDs de prueba, retiró el login `1/1` y registró deploy/health/checkout. El usuario confirmó compra, activación automática de PRO y salida del trial de siete días el 24/09; no probó restore, perfiles adicionales ni refund/revocación. Ya no corresponde afirmar «no hay Worker desplegado», «faltan todos los IDs» o «la activación automática no existe».

La discusión Paddle/Wise fue exploratoria. No hay migración Paddle implementada ni una tarea actual de cambiar proveedor. Live, aprobación y payout siguen requiriendo evidencia propia; no se infieren de Test Mode. Las comparaciones comerciales consultadas el 23/09 conservan carácter histórico y deben revalidarse si vuelve a considerarse otro proveedor.

M01 por cuenta verificada, pruebas externas restantes, producción/Store/operación y proyectos de evolución siguen abiertos en el inventario vigente. El texto extenso original y sus fuentes quedan disponibles en el historial Git de `6fe3dca`; no reutilizar su prompt de continuación.
