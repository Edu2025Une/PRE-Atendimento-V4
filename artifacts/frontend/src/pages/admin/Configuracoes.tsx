import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { getSession, clearSession, isAdmin } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import {
  getEvolutionConfig,
  saveEvolutionConfig,
  testEvolutionConfig,
  type EvolutionConfigPublic,
} from "@/lib/api";

export default function Configuracoes() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");

  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [savedConfig, setSavedConfig] = useState<EvolutionConfigPublic | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const session = getSession();
    if (!session || Date.now() >= session.expiresAt) {
      clearSession();
      navigate("/", { replace: true });
      return;
    }
    if (!isAdmin()) {
      navigate("/dashboard", { replace: true });
      return;
    }
    setToken(session.token);
    getEvolutionConfig(session.token).then(({ config }) => {
      if (config) {
        setSavedConfig(config);
        setUrl(config.url);
        setInstanceName(config.instanceName);
      }
    });
  }, [navigate]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaveMsg(null);
    if (!url.trim() || !instanceName.trim()) {
      setSaveMsg({ ok: false, text: "URL e nome da instância são obrigatórios." });
      return;
    }
    if (!apiKey.trim() && !savedConfig?.hasApiKey) {
      setSaveMsg({ ok: false, text: "API Key é obrigatória na primeira configuração." });
      return;
    }
    setSaving(true);
    try {
      const { config } = await saveEvolutionConfig(token, {
        url: url.trim(),
        apiKey: apiKey.trim(),
        instanceName: instanceName.trim(),
      });
      setSavedConfig(config);
      setApiKey("");
      setSaveMsg({ ok: true, text: "Configuração salva com sucesso." });
    } catch (e: unknown) {
      const err = e as { message?: string };
      setSaveMsg({ ok: false, text: err.message ?? "Erro ao salvar." });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTestMsg(null);
    setTesting(true);
    try {
      const result = await testEvolutionConfig(token);
      setTestMsg({ ok: result.ok, text: result.message });
    } catch (e: unknown) {
      const err = e as { message?: string };
      setTestMsg({ ok: false, text: err.message ?? "Falha na conexão." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <AppShell>
      <div className="page-title-row">
        <h1 className="page-title">Configurações</h1>
        <p className="page-subtitle">Gerencie as configurações da Evolution API.</p>
      </div>

      <section className="admin-section">
        <div className="section-header">
          <h3>Configuração da Evolution API</h3>
          {savedConfig && (
            <span className="config-badge">
              {savedConfig.hasApiKey ? "Configurado" : "Sem chave"}
            </span>
          )}
        </div>

        {savedConfig && (
          <div className="config-info-bar">
            <span>Instância vinculada: <strong>{savedConfig.instanceName}</strong></span>
            <span style={{ marginLeft: "1rem" }}>Última atualização: {new Date(savedConfig.updatedAt).toLocaleString("pt-BR")}</span>
          </div>
        )}

        <form onSubmit={handleSave} className="config-form">
          <div className="config-grid">
            <div className="field-group">
              <label htmlFor="evo-url">URL da API</label>
              <input
                id="evo-url"
                type="url"
                placeholder="https://sua-evolution-api.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="field-group">
              <label htmlFor="evo-instance">Nome da instância</label>
              <input
                id="evo-instance"
                type="text"
                placeholder="minha-instancia"
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                disabled={saving}
              />
            </div>
            <div className="field-group full-width">
              <label htmlFor="evo-key">
                API Key
                {savedConfig?.hasApiKey && (
                  <span className="field-hint"> (já configurada — deixe em branco para manter)</span>
                )}
              </label>
              <input
                id="evo-key"
                type="password"
                placeholder={savedConfig?.hasApiKey ? "••••••••••••••••" : "Sua API Key"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={saving}
                autoComplete="new-password"
              />
            </div>
          </div>

          {saveMsg && (
            <div className={saveMsg.ok ? "success-message" : "error-message"} role="alert">
              {saveMsg.text}
            </div>
          )}

          <div className="form-actions">
            <button type="submit" className="btn-primary sm" disabled={saving}>
              {saving ? <span className="btn-loading"><span className="spinner" />Salvando…</span> : "Salvar configuração"}
            </button>

            {savedConfig?.hasApiKey && (
              <button
                type="button"
                className="btn-secondary sm"
                onClick={handleTest}
                disabled={testing}
              >
                {testing ? <span className="btn-loading"><span className="spinner dark" />Testando…</span> : "Testar conexão"}
              </button>
            )}
          </div>

          {testMsg && (
            <div className={testMsg.ok ? "success-message" : "error-message"} role="alert">
              {testMsg.text}
            </div>
          )}
        </form>
      </section>

      <section className="admin-section">
        <div className="section-header">
          <h3>Gerenciar usuários</h3>
          <Link to="/admin/users" className="btn-ghost sm">Ver todos</Link>
        </div>
        <div className="empty-state">
          Acesse a página de usuários para gerenciar contas e permissões.
        </div>
      </section>
    </AppShell>
  );
}
