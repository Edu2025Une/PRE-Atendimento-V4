import { type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { getSession, clearSession } from "@/lib/auth";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  matchPrefix: string;
}

const USER_NAV: NavItem[] = [
  { to: "/dashboard",      label: "Painel",         icon: "🏠", matchPrefix: "/dashboard" },
  { to: "/contatos",       label: "Contatos",        icon: "📇", matchPrefix: "/contatos" },
  { to: "/perfil",         label: "Perfil",          icon: "👤", matchPrefix: "/perfil" },
  { to: "/minha-evolucao", label: "Configurações",   icon: "⚙️", matchPrefix: "/minha-evolucao" },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin/users",                  label: "Usuários",  icon: "👥", matchPrefix: "/admin/users" },
  { to: "/admin/evolution-connections",  label: "Conexões",  icon: "🔗", matchPrefix: "/admin/evolution-connections" },
  { to: "/admin/audit",                  label: "Auditoria", icon: "📋", matchPrefix: "/admin/audit" },
];

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const session = getSession();
  const user = session?.user;
  const admin = user?.role === "admin";

  function handleLogout() {
    clearSession();
    navigate("/", { replace: true });
  }

  function active(item: NavItem) {
    return pathname.startsWith(item.matchPrefix);
  }

  const iniciais = (user?.name ?? "U")
    .split(" ")
    .slice(0, 2)
    .map((n: string) => n[0])
    .join("")
    .toUpperCase();

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="login-logo small">PA</div>
          <span className="sidebar-brand">Pré-atendimento</span>
        </div>

        <nav className="sidebar-nav">
          {admin && (
            <>
              <span className="sidebar-section-label">Admin</span>
              {ADMIN_NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`sidebar-link${active(item) ? " active" : ""}`}
                >
                  <span className="sidebar-link-icon" aria-hidden="true">{item.icon}</span>
                  <span className="sidebar-link-label">{item.label}</span>
                </Link>
              ))}
              <div className="sidebar-divider" />
            </>
          )}

          <span className="sidebar-section-label">Menu</span>
          {USER_NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`sidebar-link${active(item) ? " active" : ""}`}
            >
              <span className="sidebar-link-icon" aria-hidden="true">{item.icon}</span>
              <span className="sidebar-link-label">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="user-avatar-small">{iniciais}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.name ?? "Usuário"}</div>
              <div className="sidebar-user-role">{admin ? "Administrador" : "Usuário"}</div>
            </div>
          </div>
          <button className="sidebar-logout" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </aside>

      <main className="app-content">
        <div className="app-content-inner">
          {children}
        </div>
      </main>
    </div>
  );
}
