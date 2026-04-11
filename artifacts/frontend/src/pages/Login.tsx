import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { loginRequest } from "@/lib/api";
import { saveSession, getSession } from "@/lib/auth";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (session && Date.now() < session.expiresAt) {
      navigate(session.user.role === "admin" ? "/admin/users" : "/dashboard", { replace: true });
    }
  }, [navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError("Preencha o e-mail e a senha.");
      return;
    }

    setLoading(true);
    try {
      const result = await loginRequest({ email, password });
      saveSession(result.token, result.user, result.expiresIn);
      navigate(result.user.role === "admin" ? "/admin/users" : "/dashboard", { replace: true });
    } catch (err: unknown) {
      const apiErr = err as { status?: number; message?: string };
      if (apiErr.status === 401) {
        setError("E-mail ou senha inválidos.");
      } else {
        setError(apiErr.message ?? "Erro de conexão. Tente novamente.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="login-logo">PA</div>
          <h1>Pré-atendimento</h1>
          <p>Entre com suas credenciais para acessar o sistema.</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form" noValidate>
          <div className="field-group">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="seu@email.com.br"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="field-group">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>

          {error && (
            <div className="error-message" role="alert">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
                <path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0M7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0z"/>
              </svg>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? (
              <span className="btn-loading">
                <span className="spinner" />
                Entrando…
              </span>
            ) : (
              "Entrar"
            )}
          </button>

          <p className="form-footer">
            Não tem conta?{" "}
            <Link to="/register">Criar conta</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
