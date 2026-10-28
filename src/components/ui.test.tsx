import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { unidadDe } from '@/pages/publico/shared';
import { Foto } from './ui';

describe('Foto', () => {
  it('muestra la imagen y, si no carga, el respaldo en vez de un ícono roto', () => {
    render(<Foto src="https://almacen/portada.jpg" alt="Portada" fallback={<span>Sin foto</span>} />);
    const img = screen.getByAltText('Portada');
    expect(img).toHaveAttribute('src', 'https://almacen/portada.jpg');
    fireEvent.error(img);
    expect(screen.queryByAltText('Portada')).not.toBeInTheDocument();
    expect(screen.getByText('Sin foto')).toBeInTheDocument();
  });

  it('sin dirección no dibuja nada (o el respaldo)', () => {
    const { container } = render(<Foto src={undefined} alt="" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('nombre de la unidad en la página pública', () => {
  it('concuerda en género y número', () => {
    const boleta = unidadDe({ unitLabel: 'boleta', unitLabelPlural: 'boletas' });
    expect(`¿Cuánt${boleta.o}s ${boleta.p} quieres?`).toBe('¿Cuántas boletas quieres?');
    expect(boleta.n(1)).toBe('boleta');
    expect(`Se vendieron tod${boleta.o}s ${boleta.los} ${boleta.p}`).toBe('Se vendieron todas las boletas');

    const numero = unidadDe({});
    expect(`¿Cuánt${numero.o}s ${numero.p} quieres?`).toBe('¿Cuántos números quieres?');
    expect(numero.P).toBe('Números');
  });
});
