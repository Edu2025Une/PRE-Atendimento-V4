import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { getSession, clearSession, type UserInfo } from "@/lib/auth";
import AppShell from "@/components/AppShell";

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    const session = getSession();
    if (!session || Date.now() >= session.expiresAt) {
      clearSession();
      navigate("/", { replace: true });
      return;
    }
    if (session.user.role === "admin") {
      navigate("/admin/users", { replace: true });
      return;
    }
    setUser(session.user);
  }, [navigate]);

  if (!user) return null;

  const iniciais = user.name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  return (
    <AppShell>
      <div className="welcome-card">
        <div className="user-avatar">{iniciais}</div>
        <div className="welcome-info">
          <h2>Olá, {user.name.split(" ")[0]}!</h2>
          <p>Bem-vindo ao sistema de pré-atendimento.</p>
        </div>
      </div>

      <div className="info-grid">
        <div className="info-card">
          <div className="info-label">Nome completo</div>
          <div className="info-value">{user.name}</div>
        </div>
        <div className="info-card">
          <div className="info-label">E-mail</div>
          <div className="info-value">{user.email}</div>
        </div>
        <div className="info-card">
          <div className="info-label">Perfil</div>
          <div className="info-value">Usuário</div>
        </div>
        <div className="info-card">
          <div className="info-label">Status</div>
          <div className="info-value status-active">
            <span className="status-dot" />
            Ativo
          </div>
        </div>
      </div>

      <section className="admin-section">
        <div className="section-header">
          <h3>Evolution API</h3>
          <Link to="/minha-evolucao" className="btn-primary sm">Configurar</Link>
        </div>
        <div className="empty-state">
          Configure sua conexão com a Evolution API para gerenciar instâncias WhatsApp.
          <br />
          <Link to="/minha-evolucao" style={{ color: "var(--primary)", fontWeight: 500, marginTop: "0.5rem", display: "inline-block" }}>
            Acessar configurações →
          </Link>
        </div>
      </section>
    </AppShell>
  );
}
