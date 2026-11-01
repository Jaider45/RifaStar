<!--
Plantilla de pull request de Rifa Star. Escríbela en español, en lenguaje claro: la va a leer
alguien que no vio el desarrollo. Los comentarios de ayuda no se ven en el PR; puedes dejarlos.
-->

## ¿Para qué sirve este cambio?

<!-- En 2 o 3 frases: qué problema resuelve o qué permite hacer, y a quién le sirve (participante,
organizador, equipo de la plataforma). Sin jerga técnica. -->

## Qué cambia

<!-- Lista corta con lo principal. Separa lo que ve el usuario de lo que es interno. -->

- **Para el usuario:**
- **Interno (API, base de datos, configuración):**

## Cómo probarlo

<!-- Pasos que cualquiera pueda repetir en su computador. Incluye usuarios, claves y datos de prueba. -->

**Preparación**

```bash
git fetch origin && git checkout <rama>
cd api && docker compose up -d --build
cd .. && npm install && npm run dev   # http://localhost:5173
```

**Pasos**

1.
2.
3.

**Resultado esperado**

-

## Capturas

<!-- Antes y después si cambia algo visual. Guárdalas en docs/capturas/<tema>/ y enlázalas con la ruta
completa de la rama, por ejemplo:
![Descripción](https://github.com/Jaider45/RifaStar/blob/<rama>/docs/capturas/<tema>/imagen.png?raw=true)
Si no hay cambio visual, escribe «No aplica». -->

## Estado del desarrollo

<!-- Marca UNA opción. -->

- [ ] 🚧 En progreso: aún falta trabajo, no está listo para unir
- [ ] 👀 Listo para revisar: terminado, falta que alguien lo revise
- [ ] ✅ Listo para unir: revisado y probado, sin pendientes

## ¿Hay errores o pendientes?

<!-- Sé honesto: aquí se decide si es seguro unir. Marca UNA opción y detalla. -->

- [ ] ✅ Todo está bien: no conozco errores ni pendientes
- [ ] ⚠️ Funciona, con pendientes menores (detállalos abajo)
- [ ] ❌ Hay errores conocidos que bloquean (detállalos abajo)

**Detalle de errores y pendientes**

-

**Lo que NO se pudo probar** (y por qué)

-

## Verificaciones

<!-- Marca solo lo que realmente corriste. Si algo no aplica, déjalo sin marcar y explica por qué. -->

- [ ] `npm run lint` y `npm test` de la web
- [ ] `cd api && npm run lint && npm test`
- [ ] `npm run build` sin errores
- [ ] `api/openapi.json` al día (`npm run openapi` si cambiaron rutas)
- [ ] Probado a mano en el navegador
- [ ] La migración se aplica sobre una base limpia y el esquema coincide

## Configuración y despliegue

<!-- Variables de entorno nuevas, migraciones, pasos manuales al desplegar, cuentas externas. -->

- Variables nuevas:
- Migraciones:
- Pasos manuales:

## Riesgos y cómo revertir

<!-- ¿Qué podría salir mal en producción? ¿Cómo se vuelve atrás? Menciona si la migración es reversible. -->

-
