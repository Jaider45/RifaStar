-- Roles de base de datos de Rifa Star.
-- Lo ejecuta el superusuario al crear el contenedor (docker-entrypoint-initdb.d)
-- y el script de tests. Las migraciones otorgan los permisos sobre las tablas.
--
--  rifastar         dueño del esquema; solo para migraciones.
--  rifastar_app     la API. NO puede saltarse RLS.
--  rifastar_system  plataforma, resolución de org y despachadores de jobs. BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rifastar_app') THEN
    CREATE ROLE rifastar_app LOGIN PASSWORD 'rifastar_app' NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rifastar_system') THEN
    CREATE ROLE rifastar_system LOGIN PASSWORD 'rifastar_system' BYPASSRLS;
  END IF;
END
$$;
