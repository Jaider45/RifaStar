import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { usePlatform } from '@/api/platform-session';
import { Logo } from '@/components/Logo';
import { ErrorNote, Loading } from '@/components/ui';

/** Login de la plataforma: contraseña → (enrolar 2FA la primera vez) → código TOTP. */
export default function PlataformaLogin() {
  const { status, login, enroll, verify } = usePlatform();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setError(null), [challenge]);
  if (status === 'loading') return <Loading />;
  if (status === 'user') return <Navigate to="/plataforma" replace />;

  const step1 = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await login(email, password);
      if (r.needsEnrollment) {
        const s = await enroll(r.challengeToken);
        setSetup({ secret: s.secret, qr: await QRCode.toDataURL(s.otpauthUrl, { margin: 1, width: 200 }) });
      }
      setChallenge(r.challengeToken);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const step2 = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verify(challenge!, code);
      navigate('/plataforma', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="acceso acceso--plataforma">
      <main className="rs-claro rs-panel acceso__caja">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo variante="negro" className="acceso__logo" />
          <span className="tag-plataforma">Plataforma</span>
        </div>
        {!challenge ? (
          <form className="stack" style={{ gap: 14 }} onSubmit={step1}>
            <h1 className="h2 h2--lg">Equipo de Rifa Star</h1>
            <div>
              <label className="rs-label" htmlFor="pe">Correo</label>
              <input id="pe" className="rs-in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div>
              <label className="rs-label" htmlFor="pp">Contraseña</label>
              <input id="pp" className="rs-in" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            </div>
            <ErrorNote error={error} />
            <button type="submit" className="rs-btn rs-btn--primario" disabled={busy}>Continuar</button>
          </form>
        ) : (
          <form className="stack" style={{ gap: 14 }} onSubmit={step2}>
            <h1 className="h2 h2--lg">Verificación en dos pasos</h1>
            {setup && (
              <>
                <p className="rs-help">Escanea el código con tu app de autenticación (Google Authenticator, 1Password…).</p>
                <img src={setup.qr} alt="Código QR para la verificación en dos pasos" className="qr" width={200} height={200} />
                <p className="rs-help">O escribe la clave: <span className="rs-mono">{setup.secret}</span></p>
              </>
            )}
            <div>
              <label className="rs-label" htmlFor="pc">Código de 6 dígitos</label>
              <input
                id="pc"
                className="rs-in rs-mono"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
              />
            </div>
            <ErrorNote error={error} />
            <button type="submit" className="rs-btn rs-btn--primario" disabled={busy || code.length !== 6}>Entrar</button>
          </form>
        )}
      </main>
    </div>
  );
}
