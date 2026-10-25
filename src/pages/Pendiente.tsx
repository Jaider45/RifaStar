import { PageHeader } from '@/components/PageHeader';

/** Secciones del menú que todavía no tienen diseño. */
export default function Pendiente({ titulo }: { titulo: string }) {
  return (
    <>
      <PageHeader title={titulo} />
      <section className="rs-panel" style={{ padding: 40, textAlign: 'center' }}>
        <p className="muted" style={{ font: '600 15px/22px var(--font-sans)' }}>Esta sección todavía no está diseñada.</p>
      </section>
    </>
  );
}
