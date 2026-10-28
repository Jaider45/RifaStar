import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Raffle, RaffleStatus } from '@/api/types';
import Sorteos from './Sorteos';

const state = vi.hoisted(() => ({ permisos: ['raffles.view', 'raffles.edit'] as string[], sorteos: [] as unknown[] }));

vi.mock('@/api/session', () => ({ useSession: () => ({ me: { name: 'Michellys Tovar' } }) }));
vi.mock('@/api/hooks', () => ({
  useCan: () => (p: string) => state.permisos.includes(p),
  useOrgProfile: () => ({ data: { timezone: 'America/Bogota' } }),
  useOrgQuery: (path: string) => (path === '/v1/raffles' ? { data: state.sorteos, isLoading: false } : { data: undefined, isLoading: false }),
}));

const sorteo = (id: string, status: RaffleStatus): Raffle =>
  ({
    id,
    status,
    title: `Sorteo ${id}`,
    slug: id,
    publicUrl: `https://rifastar.co/michellys/${id}`,
    drawAt: '2026-11-01T03:40:00.000Z',
    totalNumbers: 100,
    progress: { paid: 0, held: 0, available: 100 },
    coverUrl: null,
  }) as unknown as Raffle;

const pintar = () =>
  render(
    <MemoryRouter>
      <Sorteos />
    </MemoryRouter>,
  );

describe('Mis sorteos', () => {
  beforeEach(() => {
    state.permisos = ['raffles.view', 'raffles.edit'];
    state.sorteos = [sorteo('activo', 'active'), sorteo('jugado', 'drawn'), sorteo('cancelado', 'cancelled'), sorteo('borrador', 'draft')];
  });

  it('un sorteo publicado tiene botón «Editar» y su título lleva al editor', () => {
    pintar();
    expect(screen.getByRole('link', { name: 'Editar Sorteo activo' })).toHaveAttribute('href', '/admin/sorteos/activo');
    expect(screen.getByRole('link', { name: 'Sorteo activo' })).toHaveAttribute('href', '/admin/sorteos/activo');
  });

  it('los jugados y cancelados no se editan; el borrador se continúa', () => {
    pintar();
    expect(screen.queryByRole('link', { name: 'Editar Sorteo jugado' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Editar Sorteo cancelado' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continuar' })).toHaveAttribute('href', '/admin/sorteos/borrador');
  });

  it('sin permiso de edición no aparece «Editar»', () => {
    state.permisos = ['raffles.view'];
    pintar();
    expect(screen.queryByRole('link', { name: /^Editar / })).not.toBeInTheDocument();
  });
});
