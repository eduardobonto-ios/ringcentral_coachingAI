import { useState } from 'react';
import { supabase, supabaseConfigured } from '../supabaseClient';
import logo from '../assets/valveXwelsford.png';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    setSubmitting(false);
  };

  return (
    <div className="app login-screen">
      <div className="login-card panel">
        <img
          src={logo}
          alt="Welsford x Valveman"
          style={{ display: 'block', height: 64, marginBottom: 18, padding: '10px 16px', background: '#10161a', borderRadius: 10 }}
        />
        <h1>Sign in</h1>
        <div className="sub">Coaching workspace access — your role and department come from your account.</div>

        {!supabaseConfigured && (
          <div className="login-warning">
            Sign-in isn't configured yet — VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY need to be set.
          </div>
        )}

        <form onSubmit={onSubmit} className="login-form">
          <label>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && <div className="login-error">{error}</div>}
          <button className="primary-action" type="submit" disabled={submitting || !supabaseConfigured}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <button className="ms-login" type="button" disabled title="Coming soon — this account's future centralized Microsoft/Entra ID sign-in">
          Sign in with Microsoft (coming soon)
        </button>
      </div>
    </div>
  );
}
