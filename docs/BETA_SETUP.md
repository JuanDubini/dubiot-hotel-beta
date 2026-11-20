# Preparar la beta conectada de DubIoT Hotel

La beta conectada de activos está en `app/beta.html`. La demo anterior permanece en `app/index.html` y guarda datos solo en el navegador.

## 1. Almacenamiento privado (ya aplicado)

La migración `004_equipment_photos_storage.sql` ya se ejecutó en el proyecto beta. En Supabase Storage se verificó el bucket privado `equipment-photos` y sus cuatro políticas. El SQL fuente se conserva para despliegues reproducibles.

## 2. Altas y revisión de roles

1. Abrir la beta publicada en `https://juandubini.github.io/dubiot-hotel-beta/beta.html` (una vez completada la activación de GitHub Pages). Para desarrollo local, iniciar `py -m http.server 8080 -d app` y abrir `http://localhost:8080/beta.html`; no usar `file://`.
2. El empleado crea su cuenta y confirma el correo con el enlace más reciente de Supabase. Si el enlace venció, puede usar **Reenviar confirmación de correo** en la pantalla de acceso.
3. Solicita acceso como Técnico, Personal operativo o Supervisor. En `hotel-demo`, las cuentas confirmadas de Técnico y Personal operativo se activan automáticamente. Supervisor y Responsable del hotel requieren aprobación o asignación por parte del responsable.
4. La pestaña **Verificar controles** solo aparece para responsables y supervisores. Los técnicos no pueden aprobar controles ni cambiar el estado operativo.
5. La migración `006_beta_roles_and_asset_status.sql` cierra la autoasignación de supervisor, registra el motivo de estados Crítico/Fuera de servicio y corrige los errores tipográficos de ejemplo señalados en la auditoría. Si `hotel-demo` todavía no tiene responsable, deja como primer responsable al supervisor autoaprobado más antiguo para evitar bloquear al dueño de la beta; las demás cuentas supervisor autoaprobadas pasan a pendientes. Aplicala desde Supabase → Editor SQL, después de `005`; no habilites los nuevos controles de estado antes de aplicarla.

## 3. Habilitar GitHub Pages y configurar Auth

El repositorio `JuanDubini/dubiot-hotel-beta` incluye `.github/workflows/pages.yml`. En **Settings → Pages**, seleccionar **GitHub Actions** como fuente si aún no está seleccionada. El workflow publica automáticamente al actualizar `main`; luego el sitio queda en `https://juandubini.github.io/dubiot-hotel-beta/`.

En **Authentication → URL Configuration**, agregar la URL HTTPS del sitio a `Site URL` y a `Redirect URLs` (incluí `https://juandubini.github.io/dubiot-hotel-beta/**`). Mientras se prepara localmente, agregar también `http://localhost:8080`. Mantener habilitada la verificación de correo. No publicar contraseñas ni claves `service_role` / `secret`; la interfaz usa la clave publicable en `app/supabase-config.js`.

## Alcance actual

La beta conectada implementa inicio/registro de sesión, alta de activos con foto, edición, estados, historial compartido, QR descargable, controles diarios y revisión desde el panel de PC. Órdenes de trabajo recurrentes, plan preventivo, sensores, alertas, firmas/fotos de cada control e informes PDF todavía requieren desarrollo. Antes de usar con un cliente, validar Auth, fotos, RLS y flujos de QR con cuentas ficticias de supervisor y técnico.
