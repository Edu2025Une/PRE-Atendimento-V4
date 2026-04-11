import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getSession, clearSession, isAdmin } from "@/lib/auth";
import { getAuditLog, type AuditEntry, type ApiError } from "@/lib/api";
import AdminShell from "@/components/AdminShell";

const ACTION_LABELS: Record<string, string> = {
  "user.create": "Criação de usuário",
  "user.update": "Edição de usuário",
  "user.delete": "Exclusão de usuário",
  "user.role.change": "Alteração de role",
  "user.status.change": "Alteração de status",
  "evolution-config.admin.view": "Visualização de config",
  "evolution-config.admin.update": "Atualização de config",
};

const ACTION_COLORS: Record<string, string> = {
  "user.create": "audit-create",
  "user.update": "audit-update",
  "user.delete": "audit-delete",
  "user.role.change": "audit-role",
  "user.status.change": "audit-status",
  "evolution-config.admin.view": "audit-view",
  "evolution-config.admin.update": "audit-update",
};

export default function Auditoria() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [userName, setUserName] = useState("");

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(100);

  useEffect(() => {
    const session = getSession();
    if (!session || Date.now() >= session.expiresAt) { clearSession(); navigate("/", { replace: true }); return; }
    if (!isAdmin()) { navigate("/dashboard", { replace: true }); return; }
    setToken(session.token);
    setUserName(session.user.name.split(" ")[0]);
    fetchLog(session.token, 100);
  }, [navigate]);

  async function fetchLog(tk: string, lim: number) {
    setLoading(true);
    setError(null);
    try {
      const data = await getAuditLog(tk, lim);
      setEntries(data.entries);
      setTotal(data.total);
    } catch (e) {
      setError((e as ApiError).message ?? "Erro ao carregar auditoria.");
    } finally {
      setLoading(false);
    }
  }

  function formatTs(iso: string) {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  }

  const handleLogout = () => { clearSession(); navigate("/", { replace: true }); };
  const handleRefresh = () => fetchLog(token, limit);
  const handleLimitChange = (newLimit: number) => { setLimit(newLimit); fetchLog(token, newLimit); };

  return (
    <AdminShell onLogout={handleLogout} userName={userName}>
      <div className="page-title-row">
        <h1 className="page-title">Auditoria</h1>
        <p className="page-subtitle">Registro de todas as ações administrativas.</p>
      </div>

      <section className="admin-section">
        <div className="section-header">
          <h3>
            Log de ações
            <span className="user-count" style={{ marginLeft: "0.5rem" }}>{total} no total</span>
          </h3>
          <div className="header-actions">
            <select
              className="limit-select"
              value={limit}
              onChange={(e) => handleLimitChange(Number(e.target.value))}
              disabled={loading}
            >
              <option value={50}>Últimas 50</option>
              <option value={100}>Últimas 100</option>
              <option value={200}>Últimas 200</option>
              <option value={500}>Últimas 500</option>
            </select>
            <button className="btn-ghost sm" onClick={handleRefresh} disabled={loading}>
              Atualizar
            </button>
          </div>
        </div>

        {loading ? (
          <div className="users-loading"><span className="spinner dark" />Carregando…</div>
        ) : error ? (
          <div className="error-message" style={{ margin: "1rem" }}>{error}</div>
        ) : entries.length === 0 ? (
          <div className="empty-state">Nenhuma ação registrada ainda.</div>
        ) : (
          <div className="users-table-wrapper">
            <table className="users-table audit-table">
              <thead>
                <tr>
                  <th>Data/hora</th>
                  <th>Admin</th>
                  <th>Ação</th>
                  <th>Alvo</th>
                  <th>Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="date-cell mono">{formatTs(e.timestamp)}</td>
                    <td>
                      <div className="user-name-line">{e.adminEmail}</div>
                    </td>
                    <td>
                      <span className={`audit-badge ${ACTION_COLORS[e.action] ?? "audit-update"}`}>
                        {ACTION_LABELS[e.action] ?? e.action}
                      </span>
                    </td>
                    <td className="user-email-line">{e.targetEmail ?? e.targetId}</td>
                    <td className="audit-detail">{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
