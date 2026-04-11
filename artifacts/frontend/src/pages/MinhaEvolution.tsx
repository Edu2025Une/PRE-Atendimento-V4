import { useState, useEffect, useRef, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getSession, clearSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import {
  getEvolutionConfig,
  saveEvolutionConfig,
  getInstanceStatus,
  getInstanceQRCode,
  restartInstance,
  logoutInstance,
  createInstance,
  type EvolutionConfigPublic,
} from "@/lib/api";

type ConnPhase =
  | "idle"
  | "loading"
  | "connected"
  | "disconnected"
  | "connecting"
  | "qr-loading"
  | "qr-ready"
  | "restarting"
  | "logging-out";

interface QRData {
  base64: string;
  code?: string;
}

function extractConnState(data: Record<string, unknown>): string {
  const inst = data.instance as Record<string, unknown> | undefined;
  return (
    (inst?.state as string) ??
    (inst?.status as string) ??
    (data.state as string) ??
    "unknown"
  );
}

function extractQR(data: Record<string, unknown>): QRData | null {
  const inst = data.instance as Record<string, unknown> | undefined;
  const b64 = (inst?.base64 ?? data.base64) as string | undefined;
  const code = (inst?.code ?? data.code) as string | undefined;
  if (!b64) return null;
  return { base64: b64, code };
}

function phaseFromStatus(s: string): ConnPhase {
  if (s === "open" || s === "connected") return "connected";
  if (s === "connecting") return "connecting";
  if (s === "close" || s === "closed" || s === "close_wait") return "disconnected";
  return "disconnected";
}

export default function MinhaEvolution() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");
  const [savedConfig, setSavedConfig] = useState<EvolutionConfigPublic | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  // ── Connection panel ──────────────────────────────────────
  const [phase, setPhase] = useState<ConnPhase>("idle");
  const [qrData, setQrData] = useState<QRData | null>(null);
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Config form ───────────────────────────────────────────
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  // ── Create instance ───────────────────────────────────────
  const [creatingInstance, setCreatingInstance] = useState(false);
  const [createMsg, setCreateMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ── Test connection ───────────────────────────────────────
  const [testingConn, setTestingConn] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ── Auth + config load ────────────────────────────────────
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
        setInstanceName(config.instanceName);
        if (config.hasApiKey) {
          fetchStatus(tk, config.instanceName);
        } else {
          setPhase("disconnected");
          setConfigOpen(true);
        }
      } else {
        setPhase("idle");
        setConfigOpen(true);
      }
    } catch {
      setPhase("idle");
    } finally {
      setLoadingConfig(false);
    }
  }

  // ── Status fetch ──────────────────────────────────────────
  async function fetchStatus(tk: string, name: string) {
    setPhase("loading");
    try {
      const data = await getInstanceStatus(tk, name);
      const state = extractConnState(data as Record<string, unknown>);
      setPhase(phaseFromStatus(state));
    } catch {
      setPhase("disconnected");
    }
  }

  // ── Polling ───────────────────────────────────────────────
  function startPolling(tk: string, name: string) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const data = await getInstanceStatus(tk, name);
        const state = extractConnState(data as Record<string, unknown>);
        const newPhase = phaseFromStatus(state);
        if (newPhase === "connected") {
          stopPolling();
          setQrData(null);
          setPhase("connected");
        } else if (newPhase !== "qr-ready") {
          setPhase(p => p === "qr-ready" ? p : newPhase);
        }
      } catch { /* keep polling */ }
    }, 4000);
  }

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }

  useEffect(() => () => stopPolling(), []);

  // ── QR Code ───────────────────────────────────────────────
  async function handleGetQR() {
    const instName = savedConfig?.instanceName ?? "";
    if (!instName || !token) return;
    setActionMsg(null);
    setPhase("qr-loading");
    try {
      const data = await getInstanceQRCode(token, instName);
      const qr = extractQR(data as Record<string, unknown>);
      if (qr) {
        setQrData(qr);
        setPhase("qr-ready");
        startPolling(token, instName);
      } else {
        setActionMsg({ ok: false, text: "QR Code não retornado. Verifique se a instância foi criada." });
        setPhase("disconnected");
      }
    } catch (e: unknown) {
      const err = e as { message?: string; status?: number };
      if (err.status === 409) {
        setActionMsg({ ok: true, text: "A instância já está conectada. Atualizando status…" });
        setPhase("loading");
        setTimeout(() => fetchStatus(token, instName), 800);
      } else {
        const msg = err.message ?? "Falha ao obter QR Code.";
        const notFound = msg.toLowerCase().includes("não encontrada") || msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("404");
        setActionMsg({
          ok: false,
          text: notFound
            ? "Instância não encontrada. Vá até 'Instância na Evolution API' abaixo e clique em Criar instância primeiro."
            : msg,
        });
        setPhase("disconnected");
      }
    }
  }

  // ── Refresh status ────────────────────────────────────────
  async function handleRefreshStatus() {
    if (!savedConfig || !token) return;
    setActionMsg(null);
    await fetchStatus(token, savedConfig.instanceName);
  }

  // ── Restart ───────────────────────────────────────────────
  async function handleRestart() {
    if (!savedConfig || !token) return;
    setActionMsg(null);
    stopPolling();
    setQrData(null);
    setPhase("restarting");
    try {
      await restartInstance(token, savedConfig.instanceName);
      setActionMsg({ ok: true, text: "Instância reiniciada. Aguardando reconexão…" });
      setTimeout(() => fetchStatus(token, savedConfig.instanceName), 2500);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setActionMsg({ ok: false, text: err.message ?? "Falha ao reiniciar." });
      setPhase("disconnected");
    }
  }

  // ── Logout ────────────────────────────────────────────────
  async function handleLogout() {
    if (!savedConfig || !token) return;
    if (!confirm(`Desconectar o WhatsApp da instância "${savedConfig.instanceName}"?`)) return;
    setActionMsg(null);
    stopPolling();
    setQrData(null);
    setPhase("logging-out");
    try {
      const result = await logoutInstance(token, savedConfig.instanceName);
      setActionMsg({ ok: true, text: result.message });
      setPhase("disconnected");
    } catch (e: unknown) {
      const err = e as { message?: string };
      setActionMsg({ ok: false, text: err.message ?? "Falha ao desconectar." });
      setPhase("connected");
    }
  }

  // ── Create instance ───────────────────────────────────────
  async function handleCreateInstance() {
    if (!token || !savedConfig) return;
    setCreateMsg(null);
    setCreatingInstance(true);
    try {
      await createInstance(token, { instanceName: savedConfig.instanceName });
      setCreateMsg({ ok: true, text: `Instância "${savedConfig.instanceName}" criada com sucesso! Agora clique em "Obter QR Code" para conectar.` });
      setTimeout(() => fetchStatus(token, savedConfig.instanceName), 1200);
    } catch (e: unknown) {
      const err = e as { message?: string };
      const msg = err.message ?? "Erro ao criar instância.";
      setCreateMsg({ ok: false, text: msg });
    } finally {
      setCreatingInstance(false);
    }
  }

  // ── Save config ───────────────────────────────────────────
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
        url: url.trim(), apiKey: apiKey.trim(), instanceName: instanceName.trim(),
      });
      setSavedConfig(config);
      setApiKey("");
      setSaveMsg({ ok: true, text: "Configuração salva! Buscando status…" });
      setConfigOpen(false);
      stopPolling();
      setQrData(null);
      fetchStatus(token, config.instanceName);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setSaveMsg({ ok: false, text: err.message ?? "Erro ao salvar." });
    } finally {
      setSaving(false);
    }
  }

  // ── Test connection ───────────────────────────────────────
  async function handleTestConn() {
    if (!token) return;
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

  // ── Derived helpers ───────────────────────────────────────
  const canAct = !!savedConfig?.hasApiKey;
  const isWorking = phase === "qr-loading" || phase === "restarting" || phase === "logging-out" || phase === "loading";
  const activeInstance = savedConfig?.instanceName ?? "";

  // ── Render ────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="page-title-row">
        <div>
          <h1 className="page-title">Minha Evolution API</h1>
          <p className="page-subtitle">Conecte seu WhatsApp via QR Code e gerencie sua instância.</p>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════ */}
      {/* BLOCO 1 — Conexão WhatsApp (PRIORIDADE MÁXIMA)      */}
      {/* ═══════════════════════════════════════════════════ */}
      <section className="admin-section whatsapp-panel">
        <div className="section-header">
          <h3>Conexão WhatsApp</h3>
          {phase === "connected" && <span className="conn-badge connected">● Conectado</span>}
          {phase === "connecting" && <span className="conn-badge connecting">◌ Conectando</span>}
          {(phase === "disconnected" || phase === "qr-ready") && <span className="conn-badge disconnected">○ Desconectado</span>}
          {isWorking && <span className="conn-badge loading">⟳ Aguardando…</span>}
        </div>

        {loadingConfig ? (
          <div className="users-loading"><span className="spinner dark" />Carregando configuração…</div>
        ) : !savedConfig ? (
          <div className="whatsapp-empty">
            <div className="whatsapp-empty-icon">📱</div>
            <p>Configure sua Evolution API abaixo para conectar o WhatsApp.</p>
            <button className="btn-primary sm" onClick={() => setConfigOpen(true)}>Configurar agora</button>
          </div>
        ) : !savedConfig.hasApiKey ? (
          <div className="whatsapp-empty">
            <div className="whatsapp-empty-icon">🔑</div>
            <p>API Key não configurada. Complete a configuração para continuar.</p>
            <button className="btn-primary sm" onClick={() => setConfigOpen(true)}>Completar configuração</button>
          </div>
        ) : (
          <div className="whatsapp-body">
            {/* Instance badge */}
            <div className="whatsapp-instance-row">
              <div className="instance-icon">W</div>
              <span className="whatsapp-instance-name">{activeInstance}</span>
            </div>

            {/* QR Code or status area */}
            <div className="whatsapp-center">
              {phase === "connected" && (
                <div className="whatsapp-connected-state">
                  <div className="whatsapp-check">✓</div>
                  <p className="whatsapp-connected-text">WhatsApp conectado com sucesso!</p>
                  <p className="whatsapp-connected-sub">Sua instância <strong>{activeInstance}</strong> está online e pronta para uso.</p>
                </div>
              )}

              {phase === "qr-loading" && (
                <div className="qr-placeholder">
                  <span className="spinner dark" />
                  <span>Gerando QR Code…</span>
                </div>
              )}

              {phase === "qr-ready" && qrData && (
                <div className="qr-code-area">
                  <img
                    src={qrData.base64}
                    alt="QR Code WhatsApp"
                    className="qr-code-img"
                  />
                  <p className="qr-hint">Abra o WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
                  <p className="qr-hint-sub">O QR Code expira em aproximadamente 60 segundos</p>
                  <button
                    type="button"
                    className="btn-ghost sm"
                    onClick={handleGetQR}
                    disabled={isWorking}
                  >
                    ↺ Atualizar QR Code
                  </button>
                </div>
              )}

              {(phase === "disconnected" || phase === "connecting") && (
                <div className="qr-placeholder idle">
                  <div className="qr-placeholder-icon">📷</div>
                  <p>{phase === "connecting" ? "Conectando ao WhatsApp…" : "Clique em \"Obter QR Code\" para conectar"}</p>
                </div>
              )}

              {(phase === "restarting" || phase === "logging-out" || phase === "loading") && (
                <div className="qr-placeholder">
                  <span className="spinner dark" />
                  <span>
                    {phase === "restarting" ? "Reiniciando instância…"
                      : phase === "logging-out" ? "Desconectando…"
                      : "Verificando status…"}
                  </span>
                </div>
              )}
            </div>

            {/* Action message */}
            {actionMsg && (
              <div className={actionMsg.ok ? "success-message" : "error-message"} role="alert">
                {actionMsg.text}
              </div>
            )}

            {/* Action buttons */}
            <div className="whatsapp-actions">
              {phase !== "connected" && (
                <button
                  type="button"
                  className="btn-primary sm whatsapp-qr-btn"
                  onClick={handleGetQR}
                  disabled={isWorking || phase === "qr-ready"}
                >
                  {phase === "qr-loading"
                    ? <span className="btn-loading"><span className="spinner" />Gerando…</span>
                    : phase === "qr-ready" ? "QR Code ativo" : "📱 Obter QR Code"}
                </button>
              )}

              <button
                type="button"
                className="btn-secondary sm"
                onClick={handleRefreshStatus}
                disabled={isWorking}
              >
                ↺ Atualizar status
              </button>

              <button
                type="button"
                className="btn-secondary sm"
                onClick={handleRestart}
                disabled={isWorking}
              >
                {phase === "restarting"
                  ? <span className="btn-loading"><span className="spinner dark" />Reiniciando…</span>
                  : "⟳ Reiniciar instância"}
              </button>

              {phase === "connected" && (
                <button
                  type="button"
                  className="btn-secondary sm btn-danger-outline"
                  onClick={handleLogout}
                  disabled={isWorking}
                >
                  {phase === "logging-out"
                    ? <span className="btn-loading"><span className="spinner dark" />Desconectando…</span>
                    : "✕ Desconectar WhatsApp"}
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════ */}
      {/* BLOCO 2 — Configuração da conexão                   */}
      {/* ═══════════════════════════════════════════════════ */}
      <section className="admin-section">
        <button
          type="button"
          className="section-toggle-btn"
          onClick={() => setConfigOpen(o => !o)}
        >
          <h3>Configuração da Evolution API</h3>
          <div className="section-toggle-right">
            {savedConfig?.hasApiKey && <span className="config-badge">✓ Configurado</span>}
            {!savedConfig?.hasApiKey && <span className="config-badge unconfigured">Pendente</span>}
            <span className="section-toggle-arrow">{configOpen ? "▲" : "▼"}</span>
          </div>
        </button>

        {configOpen && (
          <form onSubmit={handleSave} className="config-form">
            {savedConfig && (
              <div className="config-info-bar">
                <span>Instância vinculada: <strong>{savedConfig.instanceName}</strong></span>
                <span style={{ marginLeft: "1rem" }}>Última atualização: {new Date(savedConfig.updatedAt).toLocaleString("pt-BR")}</span>
              </div>
            )}
            <div className="config-grid">
              <div className="field-group">
                <label htmlFor="evo-url">URL da Evolution API</label>
                <input
                  id="evo-url" type="url"
                  placeholder="https://sua-evolution-api.com"
                  value={url} onChange={e => setUrl(e.target.value)} disabled={saving}
                />
              </div>
              <div className="field-group">
                <label htmlFor="evo-instance">Nome da instância</label>
                <input
                  id="evo-instance" type="text"
                  placeholder="minha-instancia"
                  value={instanceName} onChange={e => setInstanceName(e.target.value)} disabled={saving}
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
                  id="evo-key" type="password"
                  placeholder={savedConfig?.hasApiKey ? "••••••••••••••••" : "Sua API Key"}
                  value={apiKey} onChange={e => setApiKey(e.target.value)}
                  disabled={saving} autoComplete="new-password"
                />
              </div>
            </div>

            {saveMsg && (
              <div className={saveMsg.ok ? "success-message" : "error-message"} role="alert">
                {saveMsg.text}
              </div>
            )}

            {testMsg && (
              <div className={testMsg.ok ? "success-message" : "error-message"} role="alert" style={{ marginTop: "0.75rem" }}>
                {testMsg.text}
              </div>
            )}

            <div className="form-actions" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
              <button type="submit" className="btn-primary sm" disabled={saving}>
                {saving ? <span className="btn-loading"><span className="spinner" />Salvando…</span> : "Salvar configuração"}
              </button>
              {savedConfig?.hasApiKey && (
                <button
                  type="button"
                  className="btn-secondary sm"
                  onClick={handleTestConn}
                  disabled={testingConn || saving}
                >
                  {testingConn
                    ? <span className="btn-loading"><span className="spinner dark" />Testando…</span>
                    : "🔌 Testar conexão"}
                </button>
              )}
            </div>
          </form>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════ */}
      {/* BLOCO 3 — Criar instância na Evolution API          */}
      {/* ═══════════════════════════════════════════════════ */}
      {canAct && (
        <section className="admin-section">
          <div className="section-header">
            <h3>Instância na Evolution API</h3>
          </div>
          <div style={{ padding: "0 1.25rem 1.25rem" }}>
            <p style={{ marginBottom: "0.75rem", color: "var(--text-secondary)", fontSize: "0.875rem" }}>
              Cria a instância <strong>{activeInstance}</strong> no servidor da Evolution API caso ela ainda não exista.
              Se já existir, a criação será ignorada.
            </p>
            {createMsg && (
              <div className={createMsg.ok ? "success-message" : "error-message"} role="alert" style={{ marginBottom: "0.75rem" }}>
                {createMsg.text}
              </div>
            )}
            <button
              type="button"
              className="btn-secondary sm"
              onClick={handleCreateInstance}
              disabled={creatingInstance || isWorking}
            >
              {creatingInstance
                ? <span className="btn-loading"><span className="spinner dark" />Criando…</span>
                : `Criar instância "${activeInstance}"`}
            </button>
          </div>
        </section>
      )}
    </AppShell>
  );
}
