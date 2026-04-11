import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { getSession, clearSession, isAdmin } from "@/lib/auth";
import {
  adminListUsers,
  adminCreateUser,
  adminUpdateUserName,
  adminChangeRole,
  adminChangeStatus,
  adminDeleteUser,
  type UserListItem,
  type ApiError,
} from "@/lib/api";
import AdminShell from "@/components/AdminShell";

type ActionMsg = { id: string; ok: boolean; text: string };

export default function Usuarios() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [userName, setUserName] = useState("");
  const [selfId, setSelfId] = useState("");

  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<ActionMsg | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState({ name: "", email: "", password: "", role: "user" as "admin" | "user" });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editingLoad, setEditingLoad] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (!session || Date.now() >= session.expiresAt) { clearSession(); navigate("/", { replace: true }); return; }
    if (!isAdmin()) { navigate("/dashboard", { replace: true }); return; }
    setToken(session.token);
    setUserName(session.user.name.split(" ")[0]);
    setSelfId(session.user.id);
    fetchUsers(session.token);
  }, [navigate]);

  async function fetchUsers(tk: string) {
    setLoading(true);
    setGlobalError(null);
    try {
      const { users: list } = await adminListUsers(tk);
      setUsers(list);
    } catch (e) {
      setGlobalError((e as ApiError).message ?? "Erro ao carregar usuários.");
    } finally {
      setLoading(false);
    }
  }

  function flash(id: string, ok: boolean, text: string) {
    setActionMsg({ id, ok, text });
    setTimeout(() => setActionMsg(null), 3500);
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!createForm.name.trim() || !createForm.email.trim() || !createForm.password.trim()) {
      setCreateError("Preencha todos os campos."); return;
    }
    if (createForm.password.length < 6) { setCreateError("Senha deve ter pelo menos 6 caracteres."); return; }
    setCreating(true);
    try {
      const { user } = await adminCreateUser(token, createForm);
      setUsers((prev) => [...prev, user]);
      setShowCreate(false);
      setCreateForm({ name: "", email: "", password: "", role: "user" });
      flash(user.id, true, `Usuário ${user.name} criado com sucesso.`);
    } catch (e) {
      setCreateError((e as ApiError).message ?? "Erro ao criar usuário.");
    } finally {
      setCreating(false);
    }
  }

  async function handleEditSave(id: string) {
    if (!editName.trim()) return;
    setEditingLoad(true);
    try {
      const { user } = await adminUpdateUserName(token, id, editName.trim());
      setUsers((prev) => prev.map((u) => (u.id === id ? user : u)));
      setEditingId(null);
      flash(id, true, "Nome atualizado.");
    } catch (e) {
      flash(id, false, (e as ApiError).message ?? "Erro ao atualizar.");
    } finally {
      setEditingLoad(false);
    }
  }

  async function handleRoleChange(id: string, role: "admin" | "user") {
    try {
      const { user } = await adminChangeRole(token, id, role);
      setUsers((prev) => prev.map((u) => (u.id === id ? user : u)));
      flash(id, true, `Role alterada para ${role}.`);
    } catch (e) {
      flash(id, false, (e as ApiError).message ?? "Erro ao alterar role.");
    }
  }

  async function handleStatusToggle(u: UserListItem) {
    try {
      const { user } = await adminChangeStatus(token, u.id, !u.active);
      setUsers((prev) => prev.map((x) => (x.id === u.id ? user : x)));
      flash(u.id, true, user.active ? "Conta ativada." : "Conta desativada.");
    } catch (e) {
      flash(u.id, false, (e as ApiError).message ?? "Erro.");
    }
  }

  async function handleDelete(u: UserListItem) {
    if (!window.confirm(`Excluir ${u.name} (${u.email}) permanentemente?`)) return;
    try {
      await adminDeleteUser(token, u.id);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      flash("__global", true, `${u.name} excluído.`);
    } catch (e) {
      flash("__global", false, (e as ApiError).message ?? "Erro ao excluir.");
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  const handleLogout = () => { clearSession(); navigate("/", { replace: true }); };

  return (
    <AdminShell onLogout={handleLogout} userName={userName}>
      <div className="page-title-row">
        <h1 className="page-title">Usuários</h1>
        <p className="page-subtitle">Gerencie contas, permissões e configurações.</p>
      </div>

      {actionMsg?.id === "__global" && (
        <div className={actionMsg.ok ? "success-message" : "error-message"} role="alert">
          {actionMsg.text}
        </div>
      )}

      <section className="admin-section">
        <div className="section-header">
          <h3>Todos os usuários <span className="user-count">{users.length}</span></h3>
          <button className="btn-primary sm" onClick={() => { setShowCreate(true); setCreateError(null); }}>
            + Novo usuário
          </button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} className="create-user-panel">
            <h4>Novo usuário</h4>
            <div className="config-grid">
              <div className="field-group">
                <label>Nome completo</label>
                <input type="text" placeholder="Nome" value={createForm.name} disabled={creating}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="field-group">
                <label>E-mail</label>
                <input type="email" placeholder="email@example.com" value={createForm.email} disabled={creating}
                  onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
              <div className="field-group">
                <label>Senha</label>
                <input type="password" placeholder="Mín. 6 caracteres" value={createForm.password} disabled={creating}
                  onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))} autoComplete="new-password" />
              </div>
              <div className="field-group">
                <label>Perfil</label>
                <select value={createForm.role} disabled={creating}
                  onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value as "admin" | "user" }))}>
                  <option value="user">Usuário</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
            </div>
            {createError && <div className="error-message">{createError}</div>}
            <div className="form-actions">
              <button type="submit" className="btn-primary sm" disabled={creating}>
                {creating ? <span className="btn-loading"><span className="spinner" />Criando…</span> : "Criar usuário"}
              </button>
              <button type="button" className="btn-ghost sm" onClick={() => setShowCreate(false)} disabled={creating}>Cancelar</button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="users-loading"><span className="spinner dark" />Carregando…</div>
        ) : globalError ? (
          <div className="error-message" style={{ margin: "1rem" }}>{globalError}</div>
        ) : (
          <div className="users-table-wrapper">
            <table className="users-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Perfil</th>
                  <th>Status</th>
                  <th>Criado em</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={!u.active ? "row-inactive" : ""}>
                    <td>
                      {editingId === u.id ? (
                        <div className="inline-edit-row">
                          <input
                            className="inline-edit-input"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            autoFocus
                            disabled={editingLoad}
                            onKeyDown={(e) => { if (e.key === "Enter") handleEditSave(u.id); if (e.key === "Escape") setEditingId(null); }}
                          />
                          <button className="btn-ghost sm" onClick={() => handleEditSave(u.id)} disabled={editingLoad}>✓</button>
                          <button className="btn-ghost sm" onClick={() => setEditingId(null)} disabled={editingLoad}>✕</button>
                        </div>
                      ) : (
                        <div className="user-row">
                          <div className="user-avatar-small">
                            {u.name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase()}
                          </div>
                          <div>
                            <div className="user-name-line">{u.name}</div>
                            <div className="user-email-line">{u.email}</div>
                          </div>
                        </div>
                      )}
                      {actionMsg?.id === u.id && (
                        <div className={`row-msg ${actionMsg.ok ? "ok" : "err"}`}>{actionMsg.text}</div>
                      )}
                    </td>
                    <td>
                      {u.id === selfId ? (
                        <span className={`role-badge ${u.role}`}>{u.role === "admin" ? "Admin" : "Usuário"}</span>
                      ) : (
                        <select
                          className={`role-select role-${u.role}`}
                          value={u.role}
                          onChange={(e) => handleRoleChange(u.id, e.target.value as "admin" | "user")}
                        >
                          <option value="user">Usuário</option>
                          <option value="admin">Admin</option>
                        </select>
                      )}
                    </td>
                    <td>
                      {u.id === selfId ? (
                        <span className="instance-status status-online"><span className="status-dot" />Ativo</span>
                      ) : (
                        <button
                          className={`status-toggle ${u.active ? "active" : "inactive"}`}
                          onClick={() => handleStatusToggle(u)}
                        >
                          <span className="status-dot" />
                          {u.active ? "Ativo" : "Inativo"}
                        </button>
                      )}
                    </td>
                    <td className="date-cell">{formatDate(u.createdAt)}</td>
                    <td>
                      <div className="action-row">
                        <button className="btn-action" title="Editar nome"
                          onClick={() => { setEditingId(u.id); setEditName(u.name); }}>
                          ✏️
                        </button>
                        <Link className="btn-action" title="Config Evolution" to={`/admin/users/${u.id}/evolution`}>
                          ⚙️
                        </Link>
                        {u.id !== selfId && (
                          <button className="btn-action danger" title="Excluir" onClick={() => handleDelete(u)}>
                            🗑️
                          </button>
                        )}
                      </div>
                    </td>
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
