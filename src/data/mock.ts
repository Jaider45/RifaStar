/**
 * Datos de ejemplo de la WebApp mientras no hay backend.
 * Cada pantalla los consume tal cual; cambiar aquí cambia todas las vistas.
 */

export interface Acento {
  id: 'verde' | 'rojo' | 'dorado' | 'blanco';
  nombre: string;
  color: string;
  on: string;
}

export const ACENTOS: Acento[] = [
  { id: 'verde', nombre: 'Verde Rifa Star', color: '#7eb742', on: '#0b0b0c' },
  { id: 'rojo', nombre: 'Rojo', color: '#ab1f24', on: '#ffffff' },
  { id: 'dorado', nombre: 'Dorado', color: '#ffc53d', on: '#121212' },
  { id: 'blanco', nombre: 'Blanco', color: '#f5f5f2', on: '#0b0b0c' },
];

export const LOTERIAS = ['Lotería de Boyacá', 'Lotería de Medellín', 'Lotería de Bogotá', 'Sorteo propio en vivo'];

export interface Premio {
  monto: number;
  regla: string;
  /** Texto para la vista pública de venta cuando la regla es larga. */
  reglaCorta?: string;
  /** Nombre mínimo para tablas y listas de ganadores. */
  etiqueta?: string;
}

export const ORGANIZACION = {
  nombre: 'Rifas de Michellys',
  slug: 'michellys',
  propietaria: 'Michellys Tovar',
  iniciales: 'MT',
  whatsapp: '573168110777',
  sorteosRealizados: 38,
};

/** Momento en que juega el sorteo de hoy (demo: 14 h 37 min 12 s desde que carga la app). */
export const JUEGA_EN = Date.now() + (14 * 3600 + 37 * 60 + 12) * 1000;
/** Fin del apartado de números en el checkout (demo: 29:41). */
export const APARTADO_HASTA = Date.now() + (29 * 60 + 41) * 1000;
/** Cierre del ranking del mes (demo: 6 d 14 h 02 min). */
export const RANKING_CIERRA = Date.now() + (6 * 86400 + 14 * 3600 + 2 * 60) * 1000;

export const SORTEO = {
  slug: 'boyaca-24-oct',
  titulo: 'Gana con Boyacá · Sorteo semanal',
  tituloLineas: ['Gana con Boyacá', 'Sorteo semanal'],
  nombreCorto: 'Gana con Boyacá',
  loteria: 'Lotería de Boyacá',
  fecha: '2026-10-24',
  hora: '22:40',
  fechaTexto: 'sáb 24 oct · 10:40 p. m.',
  precio: 6000,
  cifras: 2,
  total: 100,
  acento: 'verde' as Acento['id'],
  condicion: 'Participan los números totalmente pagos antes de las 3:30 p. m.',
  premios: [
    { monto: 200000, regla: 'Dos últimas cifras' },
    { monto: 80000, regla: 'Dos primeras cifras' },
    { monto: 70000, regla: 'Dos del medio' },
    { monto: 50000, regla: 'Dígito #1 y #4' },
    { monto: 30000, regla: 'Anticipado con Antioqueñita 4:00 p. m. (dos últimas cifras)', reglaCorta: 'Anticipado Antioqueñita 4:00 p. m.', etiqueta: 'Anticipado Antioqueñita' },
  ] as Premio[],
  pago: {
    llave: '3168110777',
    titular: 'José Rodríguez',
    nequi: '316 811 0777',
  },
  vendidos: [0, 1, 2, 3, 5, 9, 11, 12, 14, 15, 17, 18, 20, 21, 22, 26, 27, 28, 30, 33, 34, 35, 37, 40, 41, 42, 44, 45, 47, 50, 51, 53, 55, 56, 58, 60, 61, 63, 66, 67, 69, 70, 71, 72, 74, 77, 78, 79, 81, 83, 84, 86, 88, 89, 90, 92, 93, 95, 96, 97, 98, 99],
};

export interface FilaSorteo {
  nombre: string;
  slug: string;
  fecha: string;
  vendidos: number;
  total: number;
  recaudo: number;
  estado: 'Abierto' | 'Ganador entregado' | 'Finalizado' | 'Borrador';
  grupo: 'activos' | 'finalizados' | 'borradores';
  destino: string;
  accion: string;
}

export const MIS_SORTEOS: FilaSorteo[] = [
  { nombre: 'Gana con Boyacá · Sorteo semanal', slug: 'rifastar.co/boyaca-24-oct', fecha: 'sáb 24 oct · 10:40 p. m.', vendidos: 62, total: 100, recaudo: 372000, estado: 'Abierto', grupo: 'activos', destino: '/admin/pagos', accion: 'Ver pagos' },
  { nombre: 'Moto Yamaha NMAX 2027', slug: 'rifastar.co/moto-navidad', fecha: 'sáb 19 dic · 10:40 p. m.', vendidos: 184, total: 1000, recaudo: 1840000, estado: 'Abierto', grupo: 'activos', destino: '/admin/sorteos/nuevo', accion: 'Editar' },
  { nombre: 'Gana con Boyacá · 17 oct', slug: 'rifastar.co/boyaca-17-oct', fecha: 'sáb 17 oct', vendidos: 100, total: 100, recaudo: 600000, estado: 'Ganador entregado', grupo: 'finalizados', destino: '/admin/ganadores', accion: 'Ver resultado' },
  { nombre: 'Gana con Boyacá · 10 oct', slug: 'rifastar.co/boyaca-10-oct', fecha: 'sáb 10 oct', vendidos: 100, total: 100, recaudo: 600000, estado: 'Finalizado', grupo: 'finalizados', destino: '/admin/ganadores', accion: 'Ver resultado' },
  { nombre: 'iPhone 17 Pro', slug: 'Sin publicar', fecha: 'Sin fecha', vendidos: 0, total: 1000, recaudo: 0, estado: 'Borrador', grupo: 'borradores', destino: '/admin/sorteos/nuevo', accion: 'Continuar' },
];

export interface PagoPendiente {
  id: number;
  nombre: string;
  wa: string;
  nums: string[];
  hace: string;
  vence: string;
}

export const PAGOS_PENDIENTES: PagoPendiente[] = [
  { id: 1, nombre: 'Laura Martínez', wa: '+57 300 412 7781', nums: ['24'], hace: '4 min', vence: '10:58 a. m.' },
  { id: 2, nombre: 'Carlos Rincón', wa: '+57 311 229 0045', nums: ['40', '41', '76'], hace: '9 min', vence: '10:53 a. m.' },
  { id: 3, nombre: 'Yeni Pacheco', wa: '+57 320 661 4410', nums: ['05'], hace: '12 min', vence: '10:50 a. m.' },
  { id: 4, nombre: 'Andrés Gil', wa: '+57 315 093 7720', nums: ['48', '49'], hace: '15 min', vence: '10:47 a. m.' },
  { id: 5, nombre: 'Marta López', wa: '+57 301 441 2208', nums: ['73'], hace: '21 min', vence: '10:41 a. m.' },
  { id: 6, nombre: 'Dayana Ruiz', wa: '+57 318 550 1192', nums: ['16', '19'], hace: '26 min', vence: '10:36 a. m.' },
  { id: 7, nombre: 'Jhon Ospina', wa: '+57 304 220 8813', nums: ['62'], hace: '28 min', vence: '10:34 a. m.' },
];

/** Dueño de cada número pagado del sorteo (para calcular ganadores). */
export const DUENOS: Record<string, { nombre: string; wa: string }> = {
  '58': { nombre: 'Laura Martínez', wa: '+57 300 412 7781' },
  '40': { nombre: 'Carlos Rincón', wa: '+57 311 229 0045' },
  '05': { nombre: 'Yeni Pacheco', wa: '+57 320 661 4410' },
  '48': { nombre: 'Andrés Gil', wa: '+57 315 093 7720' },
  '73': { nombre: 'Marta López', wa: '+57 301 441 2208' },
  '16': { nombre: 'Dayana Ruiz', wa: '+57 318 550 1192' },
  '62': { nombre: 'Jhon Ospina', wa: '+57 304 220 8813' },
  '12': { nombre: 'Paola Castro', wa: '+57 316 330 3307' },
  '27': { nombre: 'Wilmer Durán', wa: '+57 312 556 5561' },
  '90': { nombre: 'Sandra Vélez', wa: '+57 305 902 9024' },
};

export interface FilaRanking {
  nombre: string;
  wa: string;
  puntos: number;
  sorteos: number;
  invertido: number;
  cambio: number;
}

export const RANKING_MES: FilaRanking[] = [
  { nombre: 'Laura Martínez', wa: '+57 300 ··· 7781', puntos: 48, sorteos: 5, invertido: 288000, cambio: 2 },
  { nombre: 'Carlos Rincón', wa: '+57 311 ··· 0045', puntos: 41, sorteos: 4, invertido: 246000, cambio: 0 },
  { nombre: 'Yeni Pacheco', wa: '+57 320 ··· 4410', puntos: 37, sorteos: 5, invertido: 222000, cambio: 3 },
  { nombre: 'Andrés Gil', wa: '+57 315 ··· 7720', puntos: 30, sorteos: 3, invertido: 180000, cambio: -1 },
  { nombre: 'Marta López', wa: '+57 301 ··· 2208', puntos: 26, sorteos: 4, invertido: 156000, cambio: -1 },
  { nombre: 'Dayana Ruiz', wa: '+57 318 ··· 1192', puntos: 22, sorteos: 2, invertido: 132000, cambio: 4 },
  { nombre: 'Jhon Ospina', wa: '+57 304 ··· 8813', puntos: 19, sorteos: 3, invertido: 114000, cambio: 0 },
  { nombre: 'Paola Castro', wa: '+57 316 ··· 3307', puntos: 17, sorteos: 2, invertido: 102000, cambio: -2 },
  { nombre: 'Wilmer Durán', wa: '+57 312 ··· 5561', puntos: 15, sorteos: 3, invertido: 90000, cambio: 1 },
  { nombre: 'Sandra Vélez', wa: '+57 305 ··· 9024', puntos: 14, sorteos: 2, invertido: 84000, cambio: -1 },
];

export const PREMIOS_RANKING = ['$300.000 en efectivo', '10 números gratis', '5 números gratis'];

export interface Organizacion {
  nombre: string;
  slug: string;
  dueno: string;
  plan: string;
  sorteos: number;
  acceso: string;
  estado: 'Activa' | 'Pago fallido' | 'En prueba' | 'Suspendida';
}

export const ORGANIZACIONES: Organizacion[] = [
  { nombre: 'Rifas de Michellys', slug: 'rifastar.co/michellys', dueno: 'Michellys Tovar', plan: 'Pro', sorteos: 2, acceso: 'Ahora', estado: 'Activa' },
  { nombre: 'Sorteos El Paisa', slug: 'rifastar.co/elpaisa', dueno: 'Hernán Zapata', plan: 'Agencia', sorteos: 6, acceso: 'Hace 1 h', estado: 'Activa' },
  { nombre: 'La Suerte de Yuli', slug: 'rifastar.co/yuli', dueno: 'Yuliana Ríos', plan: 'Básico', sorteos: 1, acceso: 'Hace 3 h', estado: 'Activa' },
  { nombre: 'Rifas Costa', slug: 'rifastar.co/costa', dueno: 'Kelly Barrios', plan: 'Pro', sorteos: 0, acceso: 'Hace 2 días', estado: 'Pago fallido' },
  { nombre: 'Moto Ya', slug: 'rifastar.co/motoya', dueno: 'Felipe Arango', plan: 'Prueba · 9 días', sorteos: 1, acceso: 'Ayer', estado: 'En prueba' },
  { nombre: 'Gana Fácil', slug: 'rifastar.co/ganafacil', dueno: 'Diego Cuervo', plan: 'Básico', sorteos: 0, acceso: 'Hace 18 días', estado: 'Suspendida' },
  { nombre: 'Premios del Valle', slug: 'rifastar.co/delvalle', dueno: 'Lorena Paz', plan: 'Pro', sorteos: 3, acceso: 'Hace 30 min', estado: 'Activa' },
];
