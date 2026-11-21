# Preparar la beta conectada de DubIoT Hotel

La beta conectada de activos está en `app/beta.html`. La demo anterior permanece en `app/index.html` y guarda datos solo en el navegador.

## 1. Almacenamiento privado (ya aplicado)

La migración `004_equipment_photos_storage.sql` ya se ejecutó en el proyecto beta. En Supabase Storage se verificó el bucket privado `equipment-photos` y sus cuatro políticas. El SQL fuente se conserva para despliegues reproducibles.

## 2. Altas y revisión de roles

1. Abrir la beta publicada en `https://juandubini.github.io/dubiot-hotel-beta/beta.html` (una vez completada la activación de GitHub Pages). Para desarrollo local, iniciar `py -m http.server 8080 -d app` y abrir `http://localhost:8080/beta.html`; no usar `file://`.
2. El empleado crea su cuenta y confirma el correo con el enlace más reciente de Supabase. Si el enlace venció, puede usar **Reenviar confirmación de correo** en la pantalla de acceso.
3. Solicita acceso como Técnico, Personal operativo o Supervisor. En `hotel-demo`, las cuentas confirmadas de Técnico y Personal operativo se activan automáticamente. Supervisor y Responsable del hotel requieren aprobación o asignación por parte del responsable.
4. La pestaña **Verificar controles** solo aparece para responsables y supervisores. Los técnicos no pueden aprobar controles ni cambiar el estado operativo.
5. La migración `006_beta_roles_and_asset_status.sql` cierra la autoasignación de supervisor, registra el motivo de estados Crítico/Fuera de servicio y corrige los errores tipográficos de ejemplo señalados en la auditoría. Si `hotel-demo` todavía no tiene responsable, deja como primer responsable al supervisor autoaprobado más antiguo para evitar bloquear al dueño de la beta; las demás cuentas supervisor autoaprobadas pasan a pendientes. En el proyecto actual `006` está aplicada: `status_reason` existe y hay un responsable activo en `hotel-demo`.
6. Ejecutar `007_work_orders_offline_catalogs.sql` desde Supabase → Editor SQL para habilitar las órdenes de trabajo, catálogos y cambios al historial del Sprint 2.
7. Ejecutar `008_platform_admin_console.sql` desde Supabase → Editor SQL. La consola global se publica en `/admin.html`. En un proyecto nuevo, asignar `platform_admin` en privado al perfil del titular con correo confirmado; no guardar el correo en el repositorio. La administración global requiere MFA.
8. En **Authentication → URL Configuration → Redirect URLs**, permitir la dirección HTTPS de `admin.html` además de `beta.html` para que los enlaces de recuperación abran el formulario para elegir una clave nueva. No se pueden consultar contraseñas actuales.

## 3. Habilitar GitHub Pages y configurar Auth

El repositorio `JuanDubini/dubiot-hotel-beta` incluye `.github/workflows/pages.yml`. En **Settings → Pages**, seleccionar **GitHub Actions** como fuente si aún no está seleccionada. El workflow publica automáticamente al actualizar `main`; luego el sitio queda en `https://juandubini.github.io/dubiot-hotel-beta/`.

En **Authentication → URL Configuration**, agregar la URL HTTPS del sitio a `Site URL` y a `Redirect URLs` (incluí `https://juandubini.github.io/dubiot-hotel-beta/**`). Mientras se prepara localmente, agregar también `http://localhost:8080`. Mantener habilitada la verificación de correo. No publicar contraseñas ni claves `service_role` / `secret`; la interfaz usa la clave publicable en `app/supabase-config.js`.

## Consola de administración global

- URL: `https://juandubini.github.io/dubiot-hotel-beta/admin.html`.
- Muestra cuentas, correos confirmados, accesos activos, pendientes y bajas por hotel y rol; permite buscar, exportar CSV, cambiar roles, aprobar/rechazar/suspender el acceso y pedir un restablecimiento por correo.
- “En línea” significa que el usuario abrió la beta y reportó actividad durante los últimos 3 minutos; no implica presencia física. Requiere la migración 008 y la versión publicada que incluye el pulso de actividad.
- Suspender una membresía corta el acceso al hotel y conserva el historial. La cuenta no se borra.
- El administrador global activa MFA con una app autenticadora. Las contraseñas son secretas incluso para el dueño: cada empleado establece y recupera la suya desde un enlace temporal enviado a su correo.

## Alcance actual

La beta tiene dos superficies: app de campo para altas, QR, controles e historial; panel de PC para revisión y gestión. El Sprint 2 agrega órdenes de trabajo con filtros/Kanban, asignación, resolución con foto, cierre por responsable, catálogos por hotel, escaneo QR y cola local sin conexión para controles e hitos. La migración `007` debe estar aplicada para habilitar esas funciones. El plan preventivo automático, sensores y alertas siguen fuera de este sprint. Antes de usar con un cliente, validar Auth, fotos, RLS y flujos de QR con cuentas ficticias de supervisor y técnico.
