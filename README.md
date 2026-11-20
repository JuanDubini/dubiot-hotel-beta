# DubIoT Hotel — starter online

El paquete contiene una **demo de interfaz**, una beta conectada para activos y migraciones SQL para la base multi-hotel. No contiene claves secretas ni publica una web por sí solo.

## Incluye
- Migraciones PostgreSQL `001` a `005` aplicadas manualmente en el proyecto beta; la `006` contiene correcciones de la auditoría y requiere aplicación antes de activar los nuevos permisos y estados.
- Beta conectada de activos e historial QR en `app/beta.html`.
- Migración adicional `004_equipment_photos_storage.sql` para fotos privadas del activo y permisos de revisión de personal.
- Esquema de hoteles, perfiles, membresías, activos, mantenimiento, incidencias, controles diarios, auditoría e historial QR.
- Políticas Row Level Security (RLS) para separar datos por hotel.
- Alta de perfiles al crear usuarios con Supabase Auth.
- Hotel inicial `Hotel Demo`.

## Importante antes de usar
Las migraciones se aplicaron manualmente en el proyecto beta `Hotel DubIoT Beta`. La tabla `hotel_invitations` de `002` y la tabla `equipment_history` (que el navegador puede mostrar traducida como `historial_del_equipo`) fueron verificadas en el Editor de tablas. La pantalla “Migraciones” de Supabase puede seguir vacía porque la ejecución manual desde el Editor SQL no registra los archivos en el historial de Supabase CLI. Las migraciones originales se conservan sin cambios.

La migración `004` también se ejecutó. Se verificó en Supabase Storage el bucket privado `equipment-photos` con cuatro políticas. Esto confirma la configuración del bucket, pero aún hay que validar los flujos Auth/RLS con cuentas de prueba antes de usar datos operativos de clientes.

## Estado de conexión

`app/index.html` sigue funcionando como demo local y guarda los datos en `localStorage`. El proyecto Supabase **Hotel DubIoT Beta** está creado en la región São Paulo. `app/beta.html` tiene activada la interfaz conectada para activos e historial. Se está preparando la publicación HTTPS de la beta; falta habilitar el primer gerente y configurar Auth para la URL final.

Las migraciones `001`, `002` y `003` se ejecutaron en el proyecto beta desde el Editor SQL, en ese orden. La demo principal no usa este esquema; la nueva vista `beta.html` sí consulta activos e historial. `002` y `003` conservan en sus comentarios originales la marca de borrador; la ejecución y presencia de tablas no equivalen a una auditoría ni a una validación completa de seguridad.

## Preparación de Supabase

1. El proyecto Supabase beta ya existe; la contraseña de base de datos está guardada por el propietario y no debe compartirse por chat ni subirse al repositorio.
2. Configurar el proveedor Email, URLs de redirección y verificación de correo.
3. Crear la cuenta inicial del responsable y asignarle el rol de administrador del hotel de forma controlada. Las solicitudes de membresía por sí solas no habilitan el acceso: requieren aprobación.
4. Validar Auth y RLS con usuarios de prueba antes de cargar información real.
5. `app/beta.html` usa la URL y clave publicable configuradas en `app/supabase-config.js`. Nunca colocar la clave `service_role` / `secret` en el navegador.

La beta conectada usa Supabase Auth y sincroniza activos, historial, controles, tareas e incidencias. La aplicación de campo está en `app/beta.html`; el panel de PC, en `app/panel.html`.

## Beta conectada de activos

Se agregó `app/beta.html`: una interfaz separada que usa Supabase Auth, consulta activos e historial compartidos, registra activos y eventos, produce QR con enlace a la ficha, y permite aprobar solicitudes de acceso a responsables del hotel. Las fotos se guardan en el bucket privado creado por la migración `004`; después hay que crear la cuenta inicial del responsable y asignarle `hotel_manager` mediante el procedimiento de bootstrap documentado en `docs/BETA_SETUP.md`.

La vista principal existente (`app/index.html`) sigue siendo la demo local. La beta conectada requiere publicar sus archivos en un hosting HTTPS, completar Auth/URLs permitidas y preparar la primera cuenta gerente. No se debe usar con datos reales de clientes hasta validar esos pasos y los permisos con cuentas de prueba.

## Publicación para celulares

La demo está en la carpeta `app/` y puede publicarse como sitio estático desde esa carpeta en un hosting con HTTPS. Configurar el dominio propio (por ejemplo `hotel.dubiot.com`) puede hacerse más adelante; para una prueba basta una URL HTTPS del hosting. Después de publicar, actualizar en Supabase las URLs permitidas de Auth. Los QR descargados deben apuntar a la URL final y abrir una ficha que consulte el historial compartido; los QR de la demo local no lo hacen.

El repositorio de publicación para GitHub Pages es `JuanDubini/dubiot-hotel-beta`. El workflow `.github/workflows/pages.yml` publica la beta desde HTTPS. La configuración de Pages, Auth y la cuenta inicial gerente deben completarse antes de habilitar al personal.

## Alta y autorización de personal

La beta conectada implementa solicitudes y aprobación de membresías. El primer gerente debe configurarse una vez siguiendo `docs/BETA_SETUP.md`; luego podrá aprobar solicitudes desde la pantalla de activos.

## Seguridad y pendientes para producción
- Mantener `service_role` / secret keys solo en servidor; nunca en navegador, repositorio ni chat.
- No permitir que un cliente edite `platform_role`.
- Configurar URLs permitidas de Auth, correo de invitación y recuperación.
- Añadir pruebas automatizadas RLS para SELECT/INSERT/UPDATE/DELETE y usuarios de dos hoteles.
- Revisar las políticas de actualización de tareas e incidencias para limitar columnas sensibles (p. ej. `created_by`, `reported_by`, `hotel_id`) con funciones o RPCs de servidor.
- Implementar exportación de informes por rango de fecha y zona horaria del hotel.
- Configurar backups, monitoreo, retención y términos de privacidad.
- La auditoría inicial registra cambios de equipos, tareas, incidencias y controles; debe ampliarse a cambios de membresías y hoteles mediante funciones de administración auditadas.
- El SQL es un punto de partida para revisión, no una certificación de seguridad ni una aplicación ya desplegada.

## Demo interactiva para presentación

Hay una primera interfaz navegable en `app/index.html`, diseñada para escritorio y celular. Incluye panel general, controles diarios, mantenimiento, incidencias, equipos, informes con descarga CSV y personal. El alta de cada activo acepta foto desde la cámara del celular, marca/modelo, serie, ubicación y observaciones; asigna un UUID QR y permite guardar eventos de revisión, reparación e incidencia en su historial. El QR abre la ficha profunda del activo una vez publicada la app en HTTPS. Los formularios, fotos y cambios de estado se guardan solo en el navegador; **esta versión es una demo y todavía no inicia sesión ni guarda datos en Supabase**.

La interfaz usa los tonos de la página de DubIoT: fondo azul pizarra `#101A24`, tarjetas `#1B2A3A`, turquesa `#2BB5A5`, azul marino `#052039` y blanco. El botón de sol/luna en la barra superior cambia entre tema oscuro y claro y recuerda la preferencia en ese navegador.

Para presentarla, abrí `app/index.html` en un navegador moderno. Para probar la instalación tipo PWA, desde la carpeta del proyecto ejecutá `py -m http.server 8080 -d app` y abrí `http://localhost:8080`. La demo se puede reiniciar desde el botón “Restablecer demo” del panel.

La beta conectada implementa activos, QR, historial, controles y revisión desde el panel de PC. La migración `006` requiere aplicarse para cerrar la autoasignación de supervisor y exigir motivo en estados críticos. Órdenes de trabajo asignables, plan preventivo, sensores/alertas, informes PDF, repuestos y documentos siguen en la hoja de ruta. La demo local anterior continúa usando datos de ejemplo del navegador.
