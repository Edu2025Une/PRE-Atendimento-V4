import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getSession, clearSession, isAdmin } from "@/lib/auth";
import {
  adminGetUserEvolutionConfig,
  adminUpdateUserEvolutionConfig,
  adminListUsers,
  type EvolutionConfigPublic,
  type UserListItem,
  type ApiError,
} from "@/lib/api";
import AdminShell from "@/components/AdminShell";

export default function UsuarioEvolution() {
  const navigate = useNavigate();
  const { id: userId } = useParams<{ id: string }>();

  const [token, setToken] = useState("");
  const [userName, setUserName] = useState("");
  const [targetUser, setTargetUser] = useState<UserListItem | null>(null);
  const [config, setConfig] = useState<EvolutionConfigPublic | null>(null);

  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [instanceName, setInstanceName] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const session = getSession();
    if (!session || Date.now() >= session.expiresAt) { clearSession(); navigate("/", { replace: true }); return; }
    if (!isAdmin()) { navigate("/dashboard", { replace: true }); return; }
    if (!userId) { navigate("/admin/users", { replace: true }); return; }

    const tk = session.token;
    setToken(tk);
    setUserName(session.user.name.split(" ")[0]);

    async function loadData() {
      setLoading(true);
      try {
        const [{ users }, { config: cfg }] = await Promise.all([
          adminListUsers(tk),
          adminGetUserEvolutionConfig(tk, userId!),
        ]);
        const found = users.find((u) => u.id === userId) ?? null;
        setTargetUser(found);
        if (cfg) {
          setConfig(cfg);
          setUrl(cfg.url);
          setInstanceName(cfg.instanceName);
        }
      } catch (e) {
        setMsg({ ok: false, text: (e as ApiError).message ?? "Erro ao carregar dados." });
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [navigate, userId]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!url.trim() || !instanceName.trim()) {
      setMsg({ ok: false, text: "URL e nome da instância são obrigatórios." }); return;
    }
    if (!apiKey.trim() && !config?.hasApiKey) {
      setMsg({ ok: false, text: "API Key é obrigatória na primeira configuração." }); return;
    }
    setSaving(true);
    try {
      const { config: saved } = await adminUpdateUserEvolutionConfig(token, userId!, {
        url: url.trim(),
        apiKey: apiKey.trim() || undefined,
        instanceName: instanceName.trim(),
      });
      setConfig(saved);
      setApiKey("");
      setMsg({ ok: true, text: "Configuração atualizada com sucesso." });
    } catch (e) {
      setMsg({ ok: false, text: (e as ApiError).message ?? "Erro ao salvar." });
    } finally {
      setSaving(false);
    }
  }

  const handleLogout = () => { clearSession(); navigate("/", { replace: true }); };

  return (
    <AdminShell onLogout={handleLogout} userName={userName}>
      <div className="page-title-row">
        <button className="btn-ghost sm back-btn" onClick={() => navigate("/admin/users")}>
          ← Voltar
        </button>
        <h1 className="page-title">
          Configuração Evolution
          {targetUser && <span className="page-title-sub"> — {targetUser.name}</span>}
        </h1>
        {targetUser && (
          <p className="page-subtitle">{targetUser.email} · <span className={`role-badge ${targetUser.role}`}>{targetUser.role === "admin" ? "Admin" : "Usuário"}</span></p>
        )}
      </div>

      <section className="admin-section">
        <div className="section-header">
          <h3>Evolution API</h3>
          {config && (
            <span className={config.hasApiKey ? "config-badge" : "role-badge user"}>
              {config.hasApiKey ? "Configurado" : "Sem chave"}
            </span>
          )}
        </div>

        {loading ? (
          <div className="users-loading"><span className="spinner dark" />Carregando…</div>
        ) : (
          <form onSubmit={handleSave} className="config-form">
            {config && (
              <div className="config-info-bar">
                <span>Última atualização: {new Date(config.updatedAt).toLocaleString("pt-BR")}</span>
              </div>
            )}

            <div className="config-grid">
              <div className="field-group">
                <label htmlFor="ev-url">URL da Evolution API</label>
                <input
                  id="ev-url" type="url"
                  placeholder="https://sua-evolution-api.com"
                  value={url} disabled={saving}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
              <div className="field-group">
                <label htmlFor="ev-instance">Nome da instância padrão</label>
                <input
                  id="ev-instance" type="text"
                  placeholder="minha-instancia"
                  value={instanceName} disabled={saving}
                  onChange={(e) => setInstanceName(e.target.value)}
                />
              </div>
              <div className="field-group full-width">
                <label htmlFor="ev-key">
                  API Key
                  {config?.hasApiKey && (
                    <span className="field-hint"> (já configurada — deixe em branco para manter)</span>
                  )}
                </label>
                <input
                  id="ev-key" type="password"
                  placeholder={config?.hasApiKey ? "••••••••••••" : "Chave de acesso"}
                  value={apiKey} disabled={saving}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>

            {msg && (
              <div className={msg.ok ? "success-message" : "error-message"} role="alert">
                {msg.text}
              </div>
            )}

            <div className="form-actions">
              <button type="submit" className="btn-primary sm" disabled={saving}>
                {saving
                  ? <span className="btn-loading"><span className="spinner" />Salvando…</span>
                  : "Salvar configuração"}
              </button>
            </div>
          </form>
        )}
      </section>
    </AdminShell>
  );
}
