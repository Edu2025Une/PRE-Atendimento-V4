import { useState, useEffect, useRef, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getSession, clearSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import {
  getEvolutionConfig,
  saveEvolutionConfig,
  testEvolutionConfig,
  listInstances,
  createInstance,
  getInstanceStatus,
  getInstanceQRCode,
  restartInstance,
  logoutInstance,
  deleteInstance,
  type EvolutionConfigPublic,
  type WhatsAppInstance,
} from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────

function extractName(inst: WhatsAppInstance): string {
  return (
    (inst.instance?.instanceName as string) ??
    (inst.instance?.name as string) ??
    (inst.instanceName as string) ??
    (inst.name as string) ??
    "—"
  );
}

function extractState(inst: WhatsAppInstance): string {
  return (
    (inst.instance?.state as string) ??
    (inst.instance?.connectionStatus as string) ??
    (inst.instance?.status as string) ??
    (inst.connectionStatus as string) ??
    (inst.status as string) ??
    "unknown"
  );
}

function normalizeState(s: string): "connected" | "disconnected" | "connecting" | "unknown" {
  const lower = s.toLowerCase();
  if (lower === "open" || lower === "connected") return "connected";
  if (lower === "connecting") return "connecting";
  if (lower === "close" || lower === "closed" || lower === "close_wait" || lower === "disconnected") return "disconnected";
  return "unknown";
}

function StateChip({ state }: { state: string }) {
  const norm = normalizeState(state);
  const map = {
    connected: { label: "Conectado", cls: "conn-badge connected" },
    connecting: { label: "Conectando", cls: "conn-badge connecting" },
    disconnected: { label: "Desconectado", cls: "conn-badge disconnected" },
    unknown: { label: "Desconhecido", cls: "conn-badge loading" },
  };
  const { label, cls } = map[norm];
  return <span className={cls}>{norm === "connected" ? "●" : norm === "connecting" ? "◌" : "○"} {label}</span>;
}

// ── QR Code modal ─────────────────────────────────────────────

interface QRModalProps {
  instanceName: string;
  token: string;
  onClose: () => void;
  onConnected: () => void;
}

function QRModal({ instanceName, token, onClose, onConnected }: QRModalProps) {
  const [phase, setPhase] = useState<"loading" | "ready" | "error" | "connected">("loading");
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPoll() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  async function loadQR() {
    setPhase("loading");
    setErrorMsg("");
    try {
      const data = await getInstanceQRCode(token, instanceName);
      const b64 = (data.instance?.base64 ?? data.base64) as string | undefined;
      if (b64) {
        setQrBase64(b64);
        setPhase("ready");
        startPoll();
      } else {
        setErrorMsg("QR Code não retornado. A instância pode já estar conectada.");
        setPhase("error");
      }
    } catch (e: unknown) {
      const err = e as { message?: string; status?: number };
      if (err.status === 409) {
        setPhase("connected");
        stopPoll();
        setTimeout(onConnected, 1500);
      } else {
        setErrorMsg(err.message ?? "Falha ao gerar QR Code.");
        setPhase("error");
      }
    }
  }

  function startPoll() {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const data = await getInstanceStatus(token, instanceName);
        const inst = data.instance as Record<string, unknown> | undefined;
        const state = ((inst?.state ?? inst?.status ?? data.state) as string) ?? "unknown";
        if (normalizeState(state) === "connected") {
          stopPoll();
          setPhase("connected");
          setTimeout(onConnected, 1200);
        }
      } catch { /* keep polling */ }
    }, 4000);
  }

  useEffect(() => { loadQR(); return stopPoll; }, []);

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { stopPoll(); onClose(); } }}>
      <div className="modal-box" style={{ maxWidth: 400 }}>
        <div className="modal-header">
          <h3>Conectar instância</h3>
          <button className="modal-close" onClick={() => { stopPoll(); onClose(); }}>✕</button>
        </div>

        <div style={{ padding: "1.5rem", textAlign: "center" }}>
          <p style={{ marginBottom: "0.5rem", fontWeight: 600 }}>{instanceName}</p>

          {phase === "loading" && (
            <div className="qr-placeholder">
              <span className="spinner dark" />
              <span>Gerando QR Code…</span>
            </div>
          )}

          {phase === "ready" && qrBase64 && (
            <div className="qr-code-area">
              <img src={qrBase64} alt="QR Code WhatsApp" className="qr-code-img" style={{ margin: "0 auto" }} />
              <p className="qr-hint">Abra o WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
              <p className="qr-hint-sub">O QR Code expira em ~60 segundos</p>
              <button type="button" className="btn-ghost sm" onClick={loadQR} style={{ marginTop: "0.5rem" }}>
                ↺ Atualizar QR Code
              </button>
            </div>
          )}

          {phase === "error" && (
            <div>
              <div className="error-message" style={{ marginBottom: "1rem" }}>{errorMsg}</div>
              <button type="button" className="btn-secondary sm" onClick={loadQR}>Tentar novamente</button>
            </div>
          )}

          {phase === "connected" && (
            <div className="whatsapp-connected-state">
              <div className="whatsapp-check">✓</div>
              <p className="whatsapp-connected-text">WhatsApp conectado!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Create instance modal ─────────────────────────────────────

interface CreateModalProps {
  token: string;
  onClose: () => void;
  onCreated: (name: string) => void;
}

function CreateModal({ token, onClose, onCreated }: CreateModalProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError("Nome da instância é obrigatório."); return; }
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      setError("Use apenas letras, números, hífen e underscore.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await createInstance(token, { instanceName: trimmed });
      onCreated(trimmed);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err.message ?? "Erro ao criar instância.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h3>Nova instância</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: "1.5rem" }}>
          <div className="field-group" style={{ marginBottom: "1rem" }}>
            <label htmlFor="inst-name">Nome da instância</label>
            <input
              id="inst-name"
              type="text"
              placeholder="ex: minha-instancia"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={loading}
              autoFocus
            />
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.25rem", display: "block" }}>
              Apenas letras, números, hífen e underscore.
            </span>
          </div>
          {error && <div className="error-message" style={{ marginBottom: "1rem" }}>{error}</div>}
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
            <button type="button" className="btn-secondary sm" onClick={onClose} disabled={loading}>Cancelar</button>
            <button type="submit" className="btn-primary sm" disabled={loading}>
              {loading ? <span className="btn-loading"><span className="spinner" />Criando…</span> : "Criar instância"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Confirm modal ─────────────────────────────────────────────

interface ConfirmModalProps {
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmModal({ message, confirmLabel, danger, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal-box" style={{ maxWidth: 380 }}>
        <div className="modal-header">
          <h3>Confirmar ação</h3>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div style={{ padding: "1.5rem" }}>
          <p style={{ marginBottom: "1.5rem" }}>{message}</p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
            <button type="button" className="btn-secondary sm" onClick={onCancel}>Cancelar</button>
            <button
              type="button"
              className={danger ? "btn-danger sm" : "btn-primary sm"}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Row action state ──────────────────────────────────────────

type RowAction = "qr" | "restart" | "logout" | "delete" | null;

interface RowState {
  action: RowAction;
  msg: { ok: boolean; text: string } | null;
}

// ── Main page ─────────────────────────────────────────────────

export default function MinhaEvolution() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [savedConfig, setSavedConfig] = useState<EvolutionConfigPublic | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);

  // Config form
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Test connection
  const [testingConn, setTestingConn] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Instances list
  const [instances, setInstances] = useState<WhatsAppInstance[]>([]);
  const [loadingInst, setLoadingInst] = useState(false);
  const [instError, setInstError] = useState("");
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  // Modals
  const [qrModal, setQrModal] = useState<string | null>(null);
  const [createModal, setCreateModal] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    instanceName: string;
    action: "logout" | "delete";
  } | null>(null);

  // ── Auth + initial load ────────────────────────────────────
  useEffect(() => {
    const session = getSession();
    if (!session || Date.now() >= session.expiresAt) {
      clearSession();
      navigate("/", { replace: true });
      return;
    }
    setToken(session.token);
    loadConfig(session.token);
  }, [navigate]);

  async function loadConfig(tk: string) {
    setLoadingConfig(true);
    try {
      const { config } = await getEvolutionConfig(tk);
      if (config) {
        setSavedConfig(config);
        setUrl(config.url);
        if (config.hasApiKey) {
          await loadInstances(tk);
        } else {
          setConfigOpen(true);
        }
      } else {
        setConfigOpen(true);
      }
    } catch {
      setConfigOpen(true);
    } finally {
      setLoadingConfig(false);
    }
  }

  // ── Load instances list ────────────────────────────────────
  async function loadInstances(tk?: string) {
    const t = tk ?? token;
    if (!t) return;
    setLoadingInst(true);
    setInstError("");
    try {
      const { instances: list } = await listInstances(t);
      setInstances(list);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setInstError(err.message ?? "Falha ao carregar instâncias.");
    } finally {
      setLoadingInst(false);
    }
  }

  // ── Config save ────────────────────────────────────────────
  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaveMsg(null);
    if (!url.trim()) {
      setSaveMsg({ ok: false, text: "A URL da Evolution API é obrigatória." });
      return;
    }
    if (!apiKey.trim() && !savedConfig?.hasApiKey) {
      setSaveMsg({ ok: false, text: "API Key é obrigatória na primeira configuração." });
      return;
    }
    setSaving(true);
    try {
      const { config } = await saveEvolutionConfig(token, { url: url.trim(), apiKey: apiKey.trim() });
      setSavedConfig(config);
      setApiKey("");
      setSaveMsg({ ok: true, text: "Configuração salva com sucesso!" });
      setConfigOpen(false);
      await loadInstances();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setSaveMsg({ ok: false, text: err.message ?? "Erro ao salvar." });
    } finally {
      setSaving(false);
    }
  }

  // ── Test connection ────────────────────────────────────────
  async function handleTestConn() {
    setTestMsg(null);
    setTestingConn(true);
    try {
      const result = await testEvolutionConfig(token);
      setTestMsg({ ok: result.ok, text: result.message });
    } catch (e: unknown) {
      const err = e as { message?: string };
      setTestMsg({ ok: false, text: err.message ?? "Falha ao testar conexão." });
    } finally {
      setTestingConn(false);
    }
  }

  // ── Row helpers ────────────────────────────────────────────
  function setRow(name: string, patch: Partial<RowState>) {
    setRowStates(prev => ({
      ...prev,
      [name]: { action: null, msg: null, ...prev[name], ...patch },
    }));
  }

  function getRow(name: string): RowState {
    return rowStates[name] ?? { action: null, msg: null };
  }

  // ── Restart ────────────────────────────────────────────────
  async function handleRestart(name: string) {
    setRow(name, { action: "restart", msg: null });
    try {
      await restartInstance(token, name);
      setRow(name, { action: null, msg: { ok: true, text: "Instância reiniciada." } });
      setTimeout(() => loadInstances(), 2000);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setRow(name, { action: null, msg: { ok: false, text: err.message ?? "Falha ao reiniciar." } });
    }
  }

  // ── Logout confirm ─────────────────────────────────────────
  async function confirmLogout(name: string) {
    setConfirmModal(null);
    setRow(name, { action: "logout", msg: null });
    try {
      const res = await logoutInstance(token, name);
      setRow(name, { action: null, msg: { ok: true, text: res.message } });
      setTimeout(() => loadInstances(), 1000);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setRow(name, { action: null, msg: { ok: false, text: err.message ?? "Falha ao desconectar." } });
    }
  }

  // ── Delete confirm ─────────────────────────────────────────
  async function confirmDelete(name: string) {
    setConfirmModal(null);
    setRow(name, { action: "delete", msg: null });
    try {
      const res = await deleteInstance(token, name);
      setRow(name, { action: null, msg: { ok: true, text: res.message } });
      setInstances(prev => prev.filter(i => extractName(i) !== name));
    } catch (e: unknown) {
      const err = e as { message?: string };
      setRow(name, { action: null, msg: { ok: false, text: err.message ?? "Falha ao apagar." } });
    }
  }

  // ── Instance created ───────────────────────────────────────
  function handleCreated(name: string) {
    setCreateModal(false);
    loadInstances();
    setQrModal(name);
  }

  return (
    <AppShell>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Minha Evolution API</h1>
          <p className="page-subtitle">Gerencie suas instâncias WhatsApp conectadas à Evolution API.</p>
        </div>
      </div>

      {/* ═══ CONFIG SECTION ════════════════════════════════════ */}
      <section className="admin-section" style={{ marginBottom: "1.5rem" }}>
        <button
          type="button"
          className="section-toggle-btn"
          onClick={() => { setConfigOpen(o => !o); setSaveMsg(null); setTestMsg(null); }}
        >
          <h3>Configuração da Evolution API</h3>
          <div className="section-toggle-right">
            {savedConfig?.hasApiKey
              ? <span className="config-badge">✓ Configurado</span>
              : <span className="config-badge unconfigured">Pendente</span>}
            <span className="section-toggle-arrow">{configOpen ? "▲" : "▼"}</span>
          </div>
        </button>

        {configOpen && (
          <form onSubmit={handleSave} className="config-form">
            {savedConfig && (
              <div className="config-info-bar">
                <span>Última atualização: {new Date(savedConfig.updatedAt).toLocaleString("pt-BR")}</span>
              </div>
            )}

            <div className="config-grid">
              <div className="field-group full-width">
                <label htmlFor="evo-url">URL da Evolution API</label>
                <input
                  id="evo-url" type="url"
                  placeholder="https://sua-evolution-api.com"
                  value={url} onChange={e => setUrl(e.target.value)} disabled={saving}
                />
              </div>
              <div className="field-group full-width">
                <label htmlFor="evo-key">
                  API Key {savedConfig?.hasApiKey && <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(deixe vazio para manter a atual)</span>}
                </label>
                <input
                  id="evo-key" type="password"
                  placeholder={savedConfig?.hasApiKey ? "••••••••••••••••" : "Cole sua API Key aqui"}
                  value={apiKey} onChange={e => setApiKey(e.target.value)} disabled={saving}
                />
              </div>
            </div>

            {saveMsg && (
              <div className={saveMsg.ok ? "success-message" : "error-message"} role="alert">
                {saveMsg.text}
              </div>
            )}
            {testMsg && (
              <div className={testMsg.ok ? "success-message" : "error-message"} role="alert">
                {testMsg.text}
              </div>
            )}

            <div className="config-actions">
              <button
                type="button"
                className="btn-secondary sm"
                onClick={handleTestConn}
                disabled={saving || testingConn || !savedConfig?.hasApiKey}
              >
                {testingConn
                  ? <span className="btn-loading"><span className="spinner dark" />Testando…</span>
                  : "↗ Testar conexão"}
              </button>
              <button type="submit" className="btn-primary sm" disabled={saving}>
                {saving
                  ? <span className="btn-loading"><span className="spinner" />Salvando…</span>
                  : "Salvar configuração"}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ═══ INSTANCES SECTION ════════════════════════════════ */}
      <section className="admin-section">
        <div className="section-header" style={{ marginBottom: "1rem" }}>
          <h3>Instâncias</h3>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <button
              type="button"
              className="btn-secondary sm"
              onClick={() => loadInstances()}
              disabled={loadingInst || !savedConfig?.hasApiKey}
            >
              {loadingInst ? <span className="btn-loading"><span className="spinner dark" />Carregando…</span> : "↺ Atualizar"}
            </button>
            <button
              type="button"
              className="btn-primary sm"
              onClick={() => setCreateModal(true)}
              disabled={!savedConfig?.hasApiKey}
            >
              + Nova instância
            </button>
          </div>
        </div>

        {loadingConfig ? (
          <div className="users-loading"><span className="spinner dark" />Carregando…</div>
        ) : !savedConfig ? (
          <div className="whatsapp-empty">
            <div className="whatsapp-empty-icon">⚙️</div>
            <p>Configure sua Evolution API acima para gerenciar instâncias.</p>
            <button className="btn-primary sm" onClick={() => setConfigOpen(true)}>Configurar agora</button>
          </div>
        ) : !savedConfig.hasApiKey ? (
          <div className="whatsapp-empty">
            <div className="whatsapp-empty-icon">🔑</div>
            <p>API Key não configurada. Complete a configuração para continuar.</p>
            <button className="btn-primary sm" onClick={() => setConfigOpen(true)}>Completar configuração</button>
          </div>
        ) : loadingInst ? (
          <div className="users-loading"><span className="spinner dark" />Buscando instâncias…</div>
        ) : instError ? (
          <div>
            <div className="error-message" style={{ marginBottom: "1rem" }}>{instError}</div>
            <button type="button" className="btn-secondary sm" onClick={() => loadInstances()}>Tentar novamente</button>
          </div>
        ) : instances.length === 0 ? (
          <div className="whatsapp-empty">
            <div className="whatsapp-empty-icon">📱</div>
            <p>Nenhuma instância encontrada na sua Evolution API.</p>
            <button className="btn-primary sm" onClick={() => setCreateModal(true)}>Criar primeira instância</button>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="users-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {instances.map((inst) => {
                  const name = extractName(inst);
                  const state = extractState(inst);
                  const row = getRow(name);
                  const busy = row.action !== null;
                  const isConnected = normalizeState(state) === "connected";

                  return (
                    <tr key={name}>
                      <td>
                        <span style={{ fontWeight: 600 }}>{name}</span>
                        {row.msg && (
                          <div
                            style={{ fontSize: "0.75rem", marginTop: "0.2rem", color: row.msg.ok ? "var(--success)" : "var(--danger)" }}
                          >
                            {row.msg.text}
                          </div>
                        )}
                      </td>
                      <td>
                        {row.action === "restart" ? <span className="conn-badge loading">⟳ Reiniciando…</span>
                          : row.action === "logout" ? <span className="conn-badge loading">⟳ Desconectando…</span>
                          : row.action === "delete" ? <span className="conn-badge loading">⟳ Apagando…</span>
                          : <StateChip state={state} />}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
                          {!isConnected && (
                            <button
                              type="button"
                              className="btn-primary sm"
                              onClick={() => setQrModal(name)}
                              disabled={busy}
                              title="Conectar via QR Code"
                            >
                              📱 Conectar
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-secondary sm"
                            onClick={() => handleRestart(name)}
                            disabled={busy}
                            title="Reiniciar instância"
                          >
                            {row.action === "restart"
                              ? <span className="btn-loading"><span className="spinner dark" /></span>
                              : "⟳ Reiniciar"}
                          </button>
                          {isConnected && (
                            <button
                              type="button"
                              className="btn-secondary sm btn-danger-outline"
                              onClick={() => setConfirmModal({ instanceName: name, action: "logout" })}
                              disabled={busy}
                              title="Desconectar WhatsApp"
                            >
                              {row.action === "logout"
                                ? <span className="btn-loading"><span className="spinner dark" /></span>
                                : "✕ Desconectar"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-secondary sm btn-danger-outline"
                            onClick={() => setConfirmModal({ instanceName: name, action: "delete" })}
                            disabled={busy}
                            title="Apagar instância permanentemente"
                          >
                            {row.action === "delete"
                              ? <span className="btn-loading"><span className="spinner dark" /></span>
                              : "🗑"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ═══ MODALS ════════════════════════════════════════════ */}
      {qrModal && (
        <QRModal
          instanceName={qrModal}
          token={token}
          onClose={() => setQrModal(null)}
          onConnected={() => { setQrModal(null); loadInstances(); }}
        />
      )}

      {createModal && (
        <CreateModal
          token={token}
          onClose={() => setCreateModal(false)}
          onCreated={handleCreated}
        />
      )}

      {confirmModal && (
        <ConfirmModal
          message={
            confirmModal.action === "delete"
              ? `Apagar permanentemente a instância "${confirmModal.instanceName}" da Evolution API? Esta ação não pode ser desfeita.`
              : `Desconectar o WhatsApp da instância "${confirmModal.instanceName}"?`
          }
          confirmLabel={confirmModal.action === "delete" ? "Apagar" : "Desconectar"}
          danger={confirmModal.action === "delete"}
          onConfirm={() =>
            confirmModal.action === "delete"
              ? confirmDelete(confirmModal.instanceName)
              : confirmLogout(confirmModal.instanceName)
          }
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </AppShell>
  );
}
