import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface PageHeaderProps {
  title: string;
  sub?: ReactNode;
  crumb?: { to: string; label: string };
  actions?: ReactNode;
}

/** Encabezado de pantalla del panel: migas opcionales, título display, bajada y acciones a la derecha. */
export function PageHeader({ title, sub, crumb, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        {crumb && (
          <Link to={crumb.to} className="crumb">
            {crumb.label}
          </Link>
        )}
        <h1 className="page-title">{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}
