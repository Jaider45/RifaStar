/**
 * Carga `.env` como efecto del import. Va PRIMERO en cada punto de entrada (main, worker,
 * openapi-export): varios módulos leen la configuración al importarse (eligen el driver de
 * correo, almacenamiento, WhatsApp…), y si el `.env` se carga después ya es tarde.
 */
import { loadDotEnv } from './env';

loadDotEnv();
