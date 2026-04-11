import { Fragment, useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { getSession, clearSession, isAdmin } from "@/lib/auth";
import { request, type ApiError } from "@/lib/api";
import AdminShell from "@/components/AdminShell";

interface Connection {
  userId: string;
  name: string;
  email: string;
  active: boolean;
  url: string | null;
  instanceName: string | null;
  hasApiKey: boolean;
  hasConfig: boolean;
  updatedAt: string | null;
}

interface Instance {
  instance?: { instanceName?: string; status?: string };
  instanceName?: string;
  status?: string;
}

type TestResult = { ok: boolean; message: string };
type RowState =
  | { type: "idle" }
  | { type: "testing" }
  | { type: "test-done"; result: TestResult }
  | { type: "loading-instances" }
  | { type: "instances"; data: Instance[]; error?: string };

export default function EvolutionConnections() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [userName, setUserName] = useState("");

  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "configured" | "unconfigured">("all");

  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [globalMsg, setGlobalMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const session = getSession();
    if (!session || Date.now() >= session.expiresAt) { clearSession(); navigate("/", { replace: true }); return; }
    if (!isAdmin()) { navigate("/dashboard", { replace: true }); return; }
    setToken(session.token);
    setUserName(session.user.name.split(" ")[0]);
  }, [navigate]);

  const fetchConnections = useCallback(async (tk: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await request<{ connections: Connection[] }>("/admin/evolution-connections", {}, tk);
      setConnections(data.connections);
    } catch (e) {
      setError((e as ApiError).message ?? "Erro ao carregar conexões.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) fetchConnections(token);
  }, [token, fetchConnections]);

  function setRow(userId: string, state: RowState) {
    setRowState((prev) => ({ ...prev, [userId]: state }));
  }

  async function handleTest(conn: Connection) {
    setRow(conn.userId, { type: "testing" });
    try {
      const result = await request<TestResult>(
        `/admin/evolution-connections/${conn.userId}/test`,
        { method: "POST" },
        token,
      );
      setRow(conn.userId, { type: "test-done", result });
    } catch (e) {
      setRow(conn.userId, {
        type: "test-done",
        result: { ok: false, message: (e as ApiError).message ?? "Falha na conexão." },
      });
    }
  }

  async function handleInstances(conn: Connection) {
    const current = rowState[conn.userId];
    if (current?.type === "instances") { setRow(conn.userId, { type: "idle" }); return; }
    setRow(conn.userId, { type: "loading-instances" });
    try {
      const data = await request<{ instances: Instance[] }>(
        `/admin/evolution-connections/${conn.userId}/instances`,
        {},
        token,
      );
      setRow(conn.userId, { type: "instances", data: data.instances });
    } catch (e) {
      setRow(conn.userId, {
        type: "instances",
        data: [],
        error: (e as ApiError).message ?? "Erro ao carregar instâncias.",
      });
    }
  }

  async function handleDelete(conn: Connection) {
    if (!window.confirm(`Remover configuração Evolution de ${conn.name} (${conn.email})?`)) return;
    setDeletingId(conn.userId);
    try {
      await request<void>(`/admin/evolution-connections/${conn.userId}`, { method: "DELETE" }, token);
      setConnections((prev) =>
        prev.map((c) =>
          c.userId === conn.userId
            ? { ...c, url: null, instanceName: null, hasApiKey: false, hasConfig: false, updatedAt: null }
            : c,
        ),
      );
      setRow(conn.userId, { type: "idle" });
      flash(true, `Configuração de ${conn.name} removida.`);
    } catch (e) {
      flash(false, (e as ApiError).message ?? "Erro ao remover configuração.");
    } finally {
      setDeletingId(null);
    }
  }

  function flash(ok: boolean, text: string) {
    setGlobalMsg({ ok, text });
    setTimeout(() => setGlobalMsg(null), 4000);
  }

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function getStatusInfo(conn: Connection) {
    if (!conn.hasConfig) return { label: "Sem config", cls: "status-badge-none" };
    if (!conn.hasApiKey) return { label: "Sem chave API", cls: "status-badge-warn" };
    return { label: "Configurado", cls: "status-badge-ok" };
  }

  function getInstanceStatus(inst: Instance) {
    const status = inst.instance?.status ?? inst.status ?? "desconhecido";
    const name = inst.instance?.instanceName ?? inst.instanceName ?? "—";
    if (status === "open" || status === "connected") return { name, label: "Conectado", cls: "status-online" };
    if (status === "connecting") return { name, label: "Conectando", cls: "status-connecting" };
    return { name, label: "Desconectado", cls: "status-offline" };
  }

  const filtered = connections.filter((c) => {
    const q = search.toLowerCase();
    const matchSearch = !q || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
    const matchStatus =
      filterStatus === "all" ||
      (filterStatus === "configured" && c.hasConfig && c.hasApiKey) ||
      (filterStatus === "unconfigured" && (!c.hasConfig || !c.hasApiKey));
    return matchSearch && matchStatus;
  });

  const handleLogout = () => { clearSession(); navigate("/", { replace: true }); };

  const configuredCount = connections.filter((c) => c.hasConfig && c.hasApiKey).length;
  const totalCount = connections.length;

  return (
    <AdminShell onLogout={handleLogout} userName={userName}>
      <div className="page-title-row">
        <h1 className="page-title">Conexões Evolution API</h1>
        <p className="page-subtitle">
          Visualize e gerencie as configurações Evolution de todos os usuários.
          <span style={{ marginLeft: "0.75rem" }}>
            <strong>{configuredCount}</strong>/{totalCount} configurados
          </span>
        </p>
      </div>

      {globalMsg && (
        <div className={globalMsg.ok ? "success-message" : "error-message"} role="alert" style={{ marginBottom: "1rem" }}>
          {globalMsg.text}
        </div>
      )}

      <section className="admin-section">
        <div className="section-header">
          <h3>
            Todos os usuários
            <span className="user-count" style={{ marginLeft: "0.5rem" }}>{filtered.length}</span>
          </h3>
          <button className="btn-ghost sm" onClick={() => fetchConnections(token)} disabled={loading}>
            Atualizar
          </button>
        </div>

        <div className="evo-filters">
          <input
            className="evo-search"
            type="search"
            placeholder="Buscar por nome ou e-mail…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="evo-filter-select"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
          >
            <option value="all">Todos os status</option>
            <option value="configured">Configurado</option>
            <option value="unconfigured">Sem configuração</option>
          </select>
        </div>

        {loading ? (
          <div className="users-loading"><span className="spinner dark" />Carregando conexões…</div>
        ) : error ? (
          <div className="error-message" style={{ margin: "1rem" }}>{error}</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">Nenhum resultado encontrado.</div>
        ) : (
          <div className="users-table-wrapper">
            <table className="users-table evo-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>URL da Evolution</th>
                  <th>Instância</th>
                  <th>Status</th>
                  <th>Atualizado</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((conn) => {
                  const status = getStatusInfo(conn);
                  const rs = rowState[conn.userId] ?? { type: "idle" };
                  const isDeleting = deletingId === conn.userId;

                  return (
                    <Fragment key={conn.userId}>
                      <tr className={!conn.active ? "row-inactive" : ""}>
                        <td>
                          <div className="user-row">
                            <div className="user-avatar-small">
                              {conn.name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase()}
                            </div>
                            <div>
                              <div className="user-name-line">{conn.name}</div>
                              <div className="user-email-line">{conn.email}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          {conn.url
                            ? <span className="evo-url" title={conn.url}>{conn.url.replace(/^https?:\/\//, "").slice(0, 30)}{conn.url.length > 37 ? "…" : ""}</span>
                            : <span className="text-muted">—</span>}
                        </td>
                        <td>
                          <span className="user-email-line">{conn.instanceName ?? "—"}</span>
                        </td>
                        <td>
                          <span className={`evo-status-badge ${status.cls}`}>{status.label}</span>
                        </td>
                        <td className="date-cell">{formatDate(conn.updatedAt)}</td>
                        <td>
                          <div className="action-row">
                            <Link
                              className="btn-action"
                              title="Editar configuração"
                              to={`/admin/users/${conn.userId}/evolution`}
                            >
                              ✏️
                            </Link>

                            {conn.hasConfig && conn.hasApiKey && (
                              <button
                                className="btn-action"
                                title="Testar conexão"
                                onClick={() => handleTest(conn)}
                                disabled={rs.type === "testing" || isDeleting}
                              >
                                {rs.type === "testing" ? <span className="spinner dark" style={{ width: 14, height: 14 }} /> : "⚡"}
                              </button>
                            )}

                            {conn.hasConfig && conn.hasApiKey && (
                              <button
                                className={`btn-action ${rs.type === "instances" ? "active" : ""}`}
                                title="Listar instâncias"
                                onClick={() => handleInstances(conn)}
                                disabled={rs.type === "loading-instances" || isDeleting}
                              >
                                {rs.type === "loading-instances" ? <span className="spinner dark" style={{ width: 14, height: 14 }} /> : "📋"}
                              </button>
                            )}

                            {conn.hasConfig && (
                              <button
                                className="btn-action danger"
                                title="Remover configuração"
                                onClick={() => handleDelete(conn)}
                                disabled={isDeleting}
                              >
                                {isDeleting ? <span className="spinner dark" style={{ width: 14, height: 14 }} /> : "🗑️"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {rs.type === "test-done" && (
                        <tr key={`${conn.userId}-test`} className="evo-detail-row">
                          <td colSpan={6}>
                            <div className={`evo-detail-content ${rs.result.ok ? "ok" : "err"}`}>
                              <strong>{rs.result.ok ? "✓" : "✕"} Teste de conexão:</strong> {rs.result.message}
                              <button className="evo-detail-close" onClick={() => setRow(conn.userId, { type: "idle" })}>✕</button>
                            </div>
                          </td>
                        </tr>
                      )}

                      {(rs.type === "instances" || rs.type === "loading-instances") && (
                        <tr key={`${conn.userId}-instances`} className="evo-detail-row">
                          <td colSpan={6}>
                            <div className="evo-detail-content instances">
                              <div className="evo-detail-header">
                                <strong>Instâncias de {conn.name}</strong>
                                <button className="evo-detail-close" onClick={() => setRow(conn.userId, { type: "idle" })}>✕</button>
                              </div>
                              {rs.type === "loading-instances" ? (
                                <div className="users-loading" style={{ padding: "0.75rem 0" }}>
                                  <span className="spinner dark" />Carregando instâncias…
                                </div>
                              ) : rs.error ? (
                                <div className="error-message">{rs.error}</div>
                              ) : rs.data.length === 0 ? (
                                <div className="text-muted" style={{ padding: "0.5rem 0" }}>Nenhuma instância encontrada.</div>
                              ) : (
                                <div className="evo-instances-list">
                                  {rs.data.map((inst, i) => {
                                    const { name, label, cls } = getInstanceStatus(inst);
                                    return (
                                      <div key={i} className="evo-instance-item">
                                        <div className="instance-icon">W</div>
                                        <span className="evo-instance-name">{name}</span>
                                        <span className={`instance-status ${cls}`}>
                                          <span className="status-dot" />{label}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
