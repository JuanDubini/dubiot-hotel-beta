# Especificación para construir DubIoT Hotel online

Producto SaaS multi-tenant para hoteles, en español, diseño dark, mobile-first.

## Jerarquía
1. Administrador global DubIoT: crea hoteles, invita usuarios, aprueba/revoca membresías y ve auditoría global.
2. Responsable del hotel: gestiona operación, verifica controles diarios, revisa incidencias e informes del hotel.
3. Supervisor: supervisa turnos, tareas y verifica controles según permisos.
4. Técnico: consulta tareas asignadas, registra controles, equipos e incidencias.
5. Personal: registra controles e incidencias según permisos.

## Flujos obligatorios
- Registro con email verificado.
- La solicitud de acceso queda pendiente y no permite consultar datos hasta aprobación.
- DubIoT aprueba la primera cuenta responsable del hotel; después puede delegar un responsable de hotel.
- Cada registro guarda hotel_id, usuario autenticado y timestamp de servidor.
- Control diario: checklist configurable por hotel/sector, resultado, observación, equipo, usuario, hora y estado de verificación.
- Informe diario online con filtros por fecha, sector, empleado y estado; exportar CSV y PDF.
- Auditoría de cambios y autorizaciones.
- Consola global separada para DubIoT: cuentas, actividad reciente, accesos activos/pendientes/bajas, reparto por hotel y rol, exportación y acciones de acceso con MFA.
- Recuperación de clave por enlace temporal al correo verificado. Ni el administrador puede leer la contraseña existente.
- Separación estricta entre hoteles con RLS.
- Responsive/PWA instalable desde navegador móvil.

## Restricciones de seguridad
- Nunca usar contraseñas de demostración en producción.
- No confiar en roles enviados desde el navegador o user_metadata editable.
- La asignación de platform_admin y la aprobación de membresías debe ocurrir en servidor o SQL administrativo restringido.
- No exponer service role / secret keys al cliente.
- Probar aislamiento con dos hoteles y usuarios de roles distintos antes de publicar.
