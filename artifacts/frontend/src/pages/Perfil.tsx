import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSession, clearSession, type UserInfo } from "@/lib/auth";
import AppShell from "@/components/AppShell";

export default function Perfil() {
  const navigate = useNavigate();
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    const session = getSession();
    if (!session || Date.now() >= session.expiresAt) {
      clearSession();
      navigate("/", { replace: true });
      return;
    }
    setUser(session.user);
  }, [navigate]);

  if (!user) return null;

  return (
    <AppShell>
      <div className="page-title-row">
        <h1 className="page-title">Perfil</h1>
        <p className="page-subtitle">Suas informações pessoais.</p>
      </div>

      <section className="admin-section">
        <div className="section-header">
          <h3>Dados da conta</h3>
        </div>
        <div className="info-grid" style={{ padding: "1.25rem" }}>
          <div className="info-card">
            <div className="info-label">Nome completo</div>
            <div className="info-value">{user.name}</div>
          </div>
          <div className="info-card">
            <div className="info-label">E-mail</div>
            <div className="info-value">{user.email}</div>
          </div>
          <div className="info-card">
            <div className="info-label">Perfil de acesso</div>
            <div className="info-value">{user.role === "admin" ? "Administrador" : "Usuário"}</div>
          </div>
          <div className="info-card">
            <div className="info-label">Status</div>
            <div className="info-value status-active">
              <span className="status-dot" />
              Ativo
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
