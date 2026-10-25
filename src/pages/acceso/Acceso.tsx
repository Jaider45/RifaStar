import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, request } from '@/api/client';
import { useSession } from '@/api/session';
import { Logo } from '@/components/Logo';
import { ErrorNote, Loading, OkNote } from '@/components/ui';
import { slugify } from '@/lib/slug';

function Caja({ titulo, sub, children, pie }: { titulo: string; sub?: string; children: ReactNode; pie?: ReactNode }) {
  return (
    <div className="rs-claro acceso">
      <main className="rs-panel acceso__caja">
        <Logo variante="negro" className="acceso__logo" />
        <div>
          <h1 className="h2 h2--lg">{titulo}</h1>
          {sub && <p className="rs-help">{sub}</p>}
        </div>
        {children}
        {pie && <p className="acceso__pie">{pie}</p>}
      </main>
    </div>
  );
}

function Campo(props: { id: string; label: string; type?: string; value: string; onChange: (v: string) => void; autoComplete?: string; help?: string; required?: boolean; inputMode?: 'numeric' }) {
  return (
    <div>
      <label className="rs-label" htmlFor={props.id}>{props.label}</label>
      <input
        id={props.id}
        className="rs-in"
        type={props.type ?? 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        required={props.required ?? true}
      />
      {props.help && <p className="rs-help">{props.help}</p>}
    </div>
  );
}

export function Login() {
  const { login, status } = useSession();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/admin';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'loading') return <Loading />;
  if (status === 'user' || status === 'support') return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password, needsCode ? code : undefined);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AUTH_2FA_REQUIRED') setNeedsCode(true);
      else setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Caja titulo="Entra a tu panel" sub="Administra tus sorteos, pagos y ganadores." pie={<>¿Aún no tienes cuenta? <Link to="/registro" className="strong-link">Crea tu organización</Link></>}>
      <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
        <Campo id="email" label="Correo" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Campo id="password" label="Contraseña" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        {needsCode && (
          <Campo id="code" label="Código de verificación" value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" help="Lo ves en tu app de autenticación." />
        )}
        <ErrorNote error={error} />
        <button type="submit" className="rs-btn rs-btn--primario" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        <Link to="/olvide" className="small-link" style={{ alignSelf: 'center' }}>Olvidé mi contraseña</Link>
      </form>
    </Caja>
  );
}


export function Registro() {
  const { signup, status } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTocado, setSlugTocado] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'user') return <Navigate to="/admin" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signup({ name, email, password, organization: { name: orgName, slug } });
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Caja titulo="Crea tu organización" sub="Empiezas con una prueba gratis. No pedimos tarjeta." pie={<>¿Ya tienes cuenta? <Link to="/login" className="strong-link">Entra</Link></>}>
      <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
        <Campo id="name" label="Tu nombre" value={name} onChange={setName} autoComplete="name" />
        <Campo id="email" label="Correo" type="email" value={email} onChange={setEmail} autoComplete="email" />
        <Campo id="password" label="Contraseña" type="password" value={password} onChange={setPassword} autoComplete="new-password" help="Mínimo 10 caracteres." />
        <Campo
          id="org"
          label="Nombre público"
          value={orgName}
          onChange={(v) => {
            setOrgName(v);
            if (!slugTocado) setSlug(slugify(v));
          }}
        />
        <div>
          <label className="rs-label" htmlFor="slug">Tu dirección</label>
          <div className="prefixed">
            <span className="prefixed__pre">rifastar.co/</span>
            <input id="slug" className="prefixed__in" value={slug} required onChange={(e) => { setSlugTocado(true); setSlug(slugify(e.target.value)); }} />
          </div>
        </div>
        <ErrorNote error={error} />
        <button type="submit" className="rs-btn rs-btn--primario" disabled={busy}>{busy ? 'Creando…' : 'Crear mi cuenta'}</button>
      </form>
    </Caja>
  );
}

interface InvitationPreview {
  organization: { name: string; slug: string };
  role: { key: string; name: string };
  email: string;
  hasAccount: boolean;
}

export function Invitacion() {
  const { token = '' } = useParams();
  const { acceptSession } = useSession();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request<InvitationPreview>(`/v1/invitations/${token}`).then(setPreview, setLoadError);
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await request<{ accessToken: string; organizationId: string }>(`/v1/invitations/${token}/accept`, {
        body: { password, ...(name && { name }) },
      });
      await acceptSession(r.accessToken, r.organizationId);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <Caja titulo="Invitación no válida"><ErrorNote error={loadError} /><Link to="/login" className="rs-btn rs-btn--secundario">Ir a entrar</Link></Caja>;
  if (!preview) return <Loading />;
  return (
    <Caja titulo={`Únete a ${preview.organization.name}`} sub={`Te invitaron como «${preview.role.name}» con el correo ${preview.email}.`}>
      <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
        {!preview.hasAccount && <Campo id="name" label="Tu nombre" value={name} onChange={setName} autoComplete="name" />}
        <Campo
          id="password"
          label={preview.hasAccount ? 'Tu contraseña de Rifa Star' : 'Crea una contraseña'}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete={preview.hasAccount ? 'current-password' : 'new-password'}
          help={preview.hasAccount ? 'Ya tienes cuenta: confirma que eres tú.' : 'Mínimo 10 caracteres.'}
        />
        <ErrorNote error={error} />
        <button type="submit" className="rs-btn rs-btn--primario" disabled={busy}>{busy ? 'Uniéndote…' : 'Aceptar invitación'}</button>
      </form>
    </Caja>
  );
}

export function Olvide() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await request<{ message: string }>('/v1/auth/password/forgot', { body: { email } });
      setSent(r.message);
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Caja titulo="Recupera tu contraseña" sub="Te enviamos un enlace a tu correo." pie={<Link to="/login" className="strong-link">Volver a entrar</Link>}>
      {sent ? (
        <OkNote>{sent}</OkNote>
      ) : (
        <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
          <Campo id="email" label="Correo" type="email" value={email} onChange={setEmail} autoComplete="email" />
          <ErrorNote error={error} />
          <button type="submit" className="rs-btn rs-btn--primario">Enviar enlace</button>
        </form>
      )}
    </Caja>
  );
}

export function Restablecer() {
  const { token = '' } = useParams();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await request('/v1/auth/password/reset', { body: { token, password } });
      setDone(true);
    } catch (err) {
      setError(err);
    }
  };
  return (
    <Caja titulo="Nueva contraseña" pie={<Link to="/login" className="strong-link">Volver a entrar</Link>}>
      {done ? (
        <OkNote>Listo. Ya puedes entrar con tu nueva contraseña.</OkNote>
      ) : (
        <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
          <Campo id="password" label="Contraseña nueva" type="password" value={password} onChange={setPassword} autoComplete="new-password" help="Mínimo 10 caracteres." />
          <ErrorNote error={error} />
          <button type="submit" className="rs-btn rs-btn--primario">Guardar contraseña</button>
        </form>
      )}
    </Caja>
  );
}
