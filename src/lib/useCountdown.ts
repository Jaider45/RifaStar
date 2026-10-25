import { useEffect, useState } from 'react';

export interface Restante {
  total: number;
  dias: number;
  horas: number;
  minutos: number;
  segundos: number;
}

function calcular(objetivo: number): Restante {
  const total = Math.max(0, objetivo - Date.now());
  const s = Math.floor(total / 1000);
  return {
    total,
    dias: Math.floor(s / 86400),
    horas: Math.floor((s % 86400) / 3600),
    minutos: Math.floor((s % 3600) / 60),
    segundos: s % 60,
  };
}

/** Cuenta regresiva que se actualiza cada segundo hasta `objetivo` (ms epoch). */
export function useCountdown(objetivo: number): Restante {
  const [restante, setRestante] = useState(() => calcular(objetivo));
  useEffect(() => {
    setRestante(calcular(objetivo));
    const id = window.setInterval(() => setRestante(calcular(objetivo)), 1000);
    return () => window.clearInterval(id);
  }, [objetivo]);
  return restante;
}
