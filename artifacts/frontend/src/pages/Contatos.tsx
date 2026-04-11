import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { getSession, clearSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import {
  fetchContacts,
  searchContacts,
  fetchChats,
  fetchMessages,
  sendTextMessage,
  sendMediaMessage,
  sendToNumber,
  sendBulkMessages,
  type Contact,
  type Chat,
  type Message,
} from "@/lib/api";

type Tab = "contatos" | "conversas";

function getContactName(c: Contact) {
  return c.pushName ?? c.name ?? c.remoteJid ?? c.phone ?? "—";
}
function getContactPhone(c: Contact) {
  const jid = c.remoteJid ?? c.id ?? "";
  return jid.replace(/@.*$/, "").replace(/^(\d+)$/, "+$1") || (c.phone ?? "—");
}
function getContactNumber(c: Contact) {
  const jid = c.remoteJid ?? c.id ?? "";
  return jid.replace(/@.*$/, "") || (c.phone ?? "");
}
function getChatName(ch: Chat) {
  return ch.pushName ?? ch.name ?? ch.remoteJid ?? "Chat";
}
function getChatId(ch: Chat) {
  return ch.remoteJid ?? ch.id ?? "";
}
function getLastMessageText(ch: Chat) {
  const lm = ch.lastMessage;
  if (!lm) return "";
  const msg = lm.message;
  if (!msg) return "";
  return (
    msg.conversation ??
    (msg.extendedTextMessage as Record<string, unknown> | undefined)?.["text"] ??
    (msg.imageMessage ? "📷 Imagem" : null) ??
    (msg.audioMessage ? "🎵 Áudio" : null) ??
    (msg.videoMessage ? "🎬 Vídeo" : null) ??
    (msg.documentMessage ? "📄 Documento" : null) ??
    "Mensagem"
  ) as string;
}
function formatTs(ts?: number | string | null) {
  if (!ts) return "";
  const d = new Date(typeof ts === "number" ? ts * 1000 : ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diff < 604800000) return d.toLocaleDateString("pt-BR", { weekday: "short" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function getMsgText(m: Message) {
  const msg = m.message;
  if (!msg) return "";
  return (
    msg.conversation ??
    (msg.extendedTextMessage as Record<string, unknown> | undefined)?.["text"] ??
    (msg.imageMessage ? "📷 Imagem" : null) ??
    (msg.audioMessage ? "🎵 Áudio" : null) ??
    (msg.videoMessage ? "🎬 Vídeo" : null) ??
    (msg.documentMessage ? "📄 Documento" : null) ??
    "Mensagem"
  ) as string;
}
function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}
function isNoConfigError(msg: string) {
  return msg.toLowerCase().includes("configure sua evolution") || msg.toLowerCase().includes("evolution api antes");
}

function exportContactsCSV(contacts: Contact[]) {
  const header = ["Nome", "Número", "JID"];
  const rows = contacts.map((c) => [
    `"${getContactName(c).replace(/"/g, '""')}"`,
    `"${getContactPhone(c)}"`,
    `"${c.remoteJid ?? c.id ?? ""}"`,
  ]);
  const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `contatos_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Contatos() {
  const navigate = useNavigate();
  const [token, setToken] = useState("");

  const [tab, setTab] = useState<Tab>("contatos");

  // ── Contacts ──────────────────────────────────────────────
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contactsError, setContactsError] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<Contact[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Multi-select ──────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ── Bulk send modal ───────────────────────────────────────
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ sent: number; failed: number } | null>(null);
  const [bulkError, setBulkError] = useState("");

  // ── Nova mensagem modal ───────────────────────────────────
  const [newMsgModal, setNewMsgModal] = useState(false);
  const [newMsgNumber, setNewMsgNumber] = useState("");
  const [newMsgText, setNewMsgText] = useState("");
  const [newMsgSending, setNewMsgSending] = useState(false);
  const [newMsgError, setNewMsgError] = useState("");
  const [newMsgSuccess, setNewMsgSuccess] = useState(false);

  // ── Chats ─────────────────────────────────────────────────
  const [chats, setChats] = useState<Chat[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [chatsError, setChatsError] = useState("");
  const [chatSearch, setChatSearch] = useState("");

  // ── Messages panel ────────────────────────────────────────
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [msgsError, setMsgsError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // ── Compose bar ───────────────────────────────────────────
  const [msgText, setMsgText] = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);
  const [sendError, setSendError] = useState("");
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const fileDocRef = useRef<HTMLInputElement | null>(null);
  const fileMediaRef = useRef<HTMLInputElement | null>(null);
  const composeRef = useRef<HTMLTextAreaElement | null>(null);

  // ── Auth ──────────────────────────────────────────────────
  useEffect(() => {
    const session = getSession();
    if (!session || Date.now() >= session.expiresAt) {
      clearSession();
      navigate("/", { replace: true });
      return;
    }
    setToken(session.token);
    loadContacts(session.token);
    loadChats(session.token);
  }, [navigate]);

  // ── Load contacts ─────────────────────────────────────────
  async function loadContacts(tk: string) {
    setLoadingContacts(true);
    setContactsError("");
    try {
      const { contacts } = await fetchContacts(tk, 1, 200);
      setContacts(contacts);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setContactsError(err.message ?? "Erro ao carregar contatos.");
    } finally {
      setLoadingContacts(false);
    }
  }

  // ── Load chats ────────────────────────────────────────────
  async function loadChats(tk: string) {
    setLoadingChats(true);
    setChatsError("");
    try {
      const { chats } = await fetchChats(tk);
      setChats(chats);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setChatsError(err.message ?? "Erro ao carregar conversas.");
    } finally {
      setLoadingChats(false);
    }
  }

  // ── Search contacts (debounced 400ms) ─────────────────────
  const handleSearchChange = useCallback((q: string) => {
    setSearchQ(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!q.trim()) { setSearchResults(null); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const { contacts } = await searchContacts(token, q.trim());
        setSearchResults(contacts);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 400);
  }, [token]);

  // ── Toggle select mode ────────────────────────────────────
  function toggleSelectMode() {
    setSelectMode((v) => !v);
    setSelectedIds(new Set());
  }

  function toggleSelectContact(c: Contact) {
    const id = c.remoteJid ?? c.id ?? getContactPhone(c);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    const displayed = searchResults ?? contacts;
    const ids = displayed.map((c) => c.remoteJid ?? c.id ?? getContactPhone(c));
    setSelectedIds(new Set(ids));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  // ── Bulk send ─────────────────────────────────────────────
  async function handleBulkSend() {
    if (!bulkText.trim() || selectedIds.size === 0) return;
    setBulkSending(true);
    setBulkError("");
    setBulkResult(null);
    try {
      const numbers = Array.from(selectedIds).map((id) => id.replace(/@.*$/, ""));
      const result = await sendBulkMessages(token, numbers, bulkText.trim());
      setBulkResult({ sent: result.sent, failed: result.failed });
      setBulkText("");
      if (result.failed === 0) {
        setTimeout(() => { setBulkModal(false); setBulkResult(null); setSelectMode(false); setSelectedIds(new Set()); }, 1500);
      }
    } catch (e: unknown) {
      const err = e as { message?: string };
      setBulkError(err.message ?? "Erro ao enviar mensagens.");
    } finally {
      setBulkSending(false);
    }
  }

  // ── Nova mensagem ─────────────────────────────────────────
  async function handleNewMsg() {
    if (!newMsgNumber.trim() || !newMsgText.trim()) return;
    setNewMsgSending(true);
    setNewMsgError("");
    setNewMsgSuccess(false);
    try {
      await sendToNumber(token, newMsgNumber.trim(), newMsgText.trim());
      setNewMsgSuccess(true);
      setNewMsgNumber("");
      setNewMsgText("");
      setTimeout(() => { setNewMsgModal(false); setNewMsgSuccess(false); }, 1500);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setNewMsgError(err.message ?? "Erro ao enviar mensagem.");
    } finally {
      setNewMsgSending(false);
    }
  }

  // ── Open chat → load messages ─────────────────────────────
  async function openChat(chat: Chat) {
    setActiveChat(chat);
    setMessages([]);
    setMsgsError("");
    setLoadingMessages(true);
    const chatId = getChatId(chat);
    try {
      const { messages } = await fetchMessages(token, chatId, 50);
      const sorted = [...messages].sort((a, b) =>
        ((a.messageTimestamp as number) ?? 0) - ((b.messageTimestamp as number) ?? 0)
      );
      setMessages(sorted);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setMsgsError(err.message ?? "Erro ao carregar mensagens.");
    } finally {
      setLoadingMessages(false);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }

  // ── Send text message ─────────────────────────────────────
  async function handleSendText() {
    if (!activeChat || !msgText.trim() || sendingMsg) return;
    const chatId = getChatId(activeChat);
    setSendingMsg(true);
    setSendError("");
    try {
      await sendTextMessage(token, chatId, msgText.trim());
      setMsgText("");
      const newMsg: Message = {
        key: { fromMe: true, remoteJid: chatId, id: `local_${Date.now()}` },
        message: { conversation: msgText.trim() },
        messageTimestamp: Math.floor(Date.now() / 1000),
      };
      setMessages((prev) => [...prev, newMsg]);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setSendError(err.message ?? "Erro ao enviar mensagem.");
    } finally {
      setSendingMsg(false);
      composeRef.current?.focus();
    }
  }

  // ── Convert File → base64 ─────────────────────────────────
  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1] ?? result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // ── Send media file ────────────────────────────────────────
  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>, type: "doc" | "media") {
    const file = e.target.files?.[0];
    if (!file || !activeChat) return;
    e.target.value = "";
    const chatId = getChatId(activeChat);
    let mediatype: "image" | "video" | "document" = "document";
    if (type === "media") {
      if (file.type.startsWith("image/")) mediatype = "image";
      else if (file.type.startsWith("video/")) mediatype = "video";
      else mediatype = "document";
    }
    setSendingMsg(true);
    setSendError("");
    try {
      const base64 = await fileToBase64(file);
      await sendMediaMessage(token, chatId, mediatype, base64, file.type, file.name, msgText.trim());
      setMsgText("");
      const label = mediatype === "image" ? "📷 Imagem" : mediatype === "video" ? "🎬 Vídeo" : `📄 ${file.name}`;
      const newMsg: Message = {
        key: { fromMe: true, remoteJid: chatId, id: `local_${Date.now()}` },
        message: { conversation: label },
        messageTimestamp: Math.floor(Date.now() / 1000),
      };
      setMessages((prev) => [...prev, newMsg]);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e: unknown) {
      const err = e as { message?: string };
      setSendError(err.message ?? "Erro ao enviar arquivo.");
    } finally {
      setSendingMsg(false);
      setAttachMenuOpen(false);
    }
  }

  // ── Filtered chats ────────────────────────────────────────
  const filteredChats = chatSearch.trim()
    ? chats.filter((ch) =>
        getChatName(ch).toLowerCase().includes(chatSearch.toLowerCase()) ||
        getChatId(ch).includes(chatSearch)
      )
    : chats;

  const displayedContacts = searchResults ?? contacts;

  const noConfig = isNoConfigError(contactsError) || isNoConfigError(chatsError);

  if (noConfig) {
    return (
      <AppShell>
        <div className="page-title-row">
          <div>
            <h1 className="page-title">Contatos & Conversas</h1>
            <p className="page-subtitle">Gerencie seus contatos e histórico de conversas do WhatsApp.</p>
          </div>
        </div>
        <div className="admin-section" style={{ maxWidth: 520, margin: "2rem auto", textAlign: "center", padding: "2.5rem 2rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚙️</div>
          <h2 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "0.5rem", color: "var(--color-text)" }}>
            Evolution API não configurada
          </h2>
          <p style={{ color: "var(--color-text-muted)", marginBottom: "1.5rem", lineHeight: 1.6 }}>
            Para acessar seus contatos e conversas do WhatsApp, você precisa configurar sua Evolution API primeiro.
          </p>
          <Link to="/minha-evolucao" className="btn-primary" style={{ display: "inline-block", textDecoration: "none" }}>
            ⚙️ Configurar Evolution API
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {/* ── Nova Mensagem Modal ─────────────────────────────── */}
      {newMsgModal && (
        <div className="modal-overlay" onClick={() => { if (!newMsgSending) { setNewMsgModal(false); setNewMsgError(""); setNewMsgSuccess(false); } }}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">✉️ Nova Mensagem</h2>
              <button className="modal-close" onClick={() => { setNewMsgModal(false); setNewMsgError(""); setNewMsgSuccess(false); }}>✕</button>
            </div>
            {newMsgSuccess ? (
              <div className="modal-success">✅ Mensagem enviada com sucesso!</div>
            ) : (
              <>
                <div className="modal-field">
                  <label className="modal-label">Número do WhatsApp</label>
                  <input
                    className="modal-input"
                    type="tel"
                    placeholder="Ex: 5511999999999"
                    value={newMsgNumber}
                    onChange={(e) => setNewMsgNumber(e.target.value)}
                    disabled={newMsgSending}
                  />
                  <span className="modal-hint">Código do país + DDD + número (apenas dígitos)</span>
                </div>
                <div className="modal-field">
                  <label className="modal-label">Mensagem</label>
                  <textarea
                    className="modal-textarea"
                    placeholder="Digite sua mensagem…"
                    rows={4}
                    value={newMsgText}
                    onChange={(e) => setNewMsgText(e.target.value)}
                    disabled={newMsgSending}
                  />
                </div>
                {newMsgError && <div className="modal-error">{newMsgError}</div>}
                <div className="modal-actions">
                  <button className="btn-ghost" onClick={() => { setNewMsgModal(false); setNewMsgError(""); }} disabled={newMsgSending}>
                    Cancelar
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => void handleNewMsg()}
                    disabled={newMsgSending || !newMsgNumber.trim() || !newMsgText.trim()}
                  >
                    {newMsgSending ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Enviando…</> : "Enviar"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Envio em Massa Modal ────────────────────────────── */}
      {bulkModal && (
        <div className="modal-overlay" onClick={() => { if (!bulkSending) { setBulkModal(false); setBulkError(""); setBulkResult(null); } }}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">📢 Envio em Massa</h2>
              <button className="modal-close" onClick={() => { setBulkModal(false); setBulkError(""); setBulkResult(null); }}>✕</button>
            </div>
            <div className="modal-info">
              <strong>{selectedIds.size}</strong> contato(s) selecionado(s)
            </div>
            {bulkResult ? (
              <div className={bulkResult.failed === 0 ? "modal-success" : "modal-partial"}>
                ✅ {bulkResult.sent} enviado(s) &nbsp;{bulkResult.failed > 0 && <span>❌ {bulkResult.failed} falhou(ram)</span>}
              </div>
            ) : (
              <>
                <div className="modal-field">
                  <label className="modal-label">Mensagem a enviar para todos</label>
                  <textarea
                    className="modal-textarea"
                    placeholder="Digite a mensagem que será enviada para todos os contatos selecionados…"
                    rows={5}
                    value={bulkText}
                    onChange={(e) => setBulkText(e.target.value)}
                    disabled={bulkSending}
                  />
                </div>
                {bulkError && <div className="modal-error">{bulkError}</div>}
                <div className="modal-actions">
                  <button className="btn-ghost" onClick={() => { setBulkModal(false); setBulkError(""); }} disabled={bulkSending}>
                    Cancelar
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => void handleBulkSend()}
                    disabled={bulkSending || !bulkText.trim() || selectedIds.size === 0}
                  >
                    {bulkSending
                      ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Enviando…</>
                      : `Enviar para ${selectedIds.size} contato(s)`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="page-title-row">
        <div>
          <h1 className="page-title">Contatos & Conversas</h1>
          <p className="page-subtitle">Gerencie seus contatos e histórico de conversas do WhatsApp.</p>
        </div>
        <button className="btn-primary" onClick={() => { setNewMsgModal(true); setNewMsgError(""); setNewMsgSuccess(false); }}>
          ✉️ Nova Mensagem
        </button>
      </div>

      {/* Tabs */}
      <div className="contacts-tabs">
        <button
          className={`contacts-tab${tab === "contatos" ? " active" : ""}`}
          onClick={() => setTab("contatos")}
        >
          📇 Contatos {contacts.length > 0 && <span className="user-count">{contacts.length}</span>}
        </button>
        <button
          className={`contacts-tab${tab === "conversas" ? " active" : ""}`}
          onClick={() => setTab("conversas")}
        >
          💬 Conversas {chats.length > 0 && <span className="user-count">{chats.length}</span>}
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════ */}
      {/* CONTATOS TAB                                          */}
      {/* ══════════════════════════════════════════════════════ */}
      {tab === "contatos" && (
        <section className="admin-section">
          {/* Search + action bar */}
          <div className="contacts-search-bar">
            <div className="search-input-wrap">
              <span className="search-icon">🔍</span>
              <input
                type="search"
                placeholder="Buscar por nome ou número…"
                value={searchQ}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="contacts-search-input"
              />
              {searching && <span className="spinner dark search-spinner" />}
              {searchQ && !searching && (
                <button className="search-clear" onClick={() => { setSearchQ(""); setSearchResults(null); }}>✕</button>
              )}
            </div>
            <div className="contacts-actions">
              <button className="btn-ghost sm" onClick={() => loadContacts(token)} disabled={loadingContacts} title="Atualizar">
                ↺ Atualizar
              </button>
              <button
                className="btn-ghost sm"
                onClick={() => exportContactsCSV(displayedContacts)}
                disabled={displayedContacts.length === 0}
                title="Exportar CSV"
              >
                ⬇ CSV
              </button>
              <button
                className={`btn-ghost sm${selectMode ? " active-select" : ""}`}
                onClick={toggleSelectMode}
                title={selectMode ? "Cancelar seleção" : "Selecionar contatos"}
              >
                {selectMode ? "✕ Cancelar" : "☑ Selecionar"}
              </button>
            </div>
          </div>

          {/* Selection toolbar */}
          {selectMode && (
            <div className="bulk-toolbar">
              <div className="bulk-toolbar-left">
                <span className="bulk-count">{selectedIds.size} selecionado(s)</span>
                <button className="bulk-link" onClick={selectAll}>Selecionar todos ({displayedContacts.length})</button>
                {selectedIds.size > 0 && <button className="bulk-link" onClick={deselectAll}>Limpar seleção</button>}
              </div>
              <button
                className="btn-primary sm"
                disabled={selectedIds.size === 0}
                onClick={() => { setBulkModal(true); setBulkText(""); setBulkError(""); setBulkResult(null); }}
              >
                📢 Enviar em massa ({selectedIds.size})
              </button>
            </div>
          )}

          {searchResults !== null && (
            <div className="contacts-search-info">
              {searchResults.length} resultado(s) para "{searchQ}"
            </div>
          )}

          {contactsError ? (
            <div className="error-message" style={{ margin: "1rem 1.25rem" }}>{contactsError}</div>
          ) : loadingContacts ? (
            <div className="users-loading"><span className="spinner dark" />Carregando contatos…</div>
          ) : displayedContacts.length === 0 ? (
            <div className="empty-state">
              {searchQ ? "Nenhum contato encontrado." : "Nenhum contato encontrado. Verifique se a Evolution API está conectada."}
            </div>
          ) : (
            <div className="contacts-grid">
              {displayedContacts.map((c, i) => {
                const name = getContactName(c);
                const phone = getContactPhone(c);
                const uid = c.remoteJid ?? c.id ?? phone;
                const isSelected = selectedIds.has(uid);
                return (
                  <div
                    key={i}
                    className={`contact-card${selectMode ? " selectable" : ""}${isSelected ? " selected" : ""}`}
                    onClick={selectMode ? () => toggleSelectContact(c) : undefined}
                  >
                    {selectMode && (
                      <div className="contact-checkbox">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectContact(c)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    )}
                    <div className="contact-avatar">
                      {c.profilePictureUrl
                        ? <img src={c.profilePictureUrl} alt={name} className="contact-avatar-img" />
                        : <span>{initials(name)}</span>
                      }
                    </div>
                    <div className="contact-info">
                      <div className="contact-name">{name}</div>
                      <div className="contact-phone">{phone}</div>
                    </div>
                    {!selectMode && (
                      <div className="contact-card-actions">
                        <button
                          className="btn-ghost sm contact-chat-btn"
                          title="Abrir conversa"
                          onClick={() => {
                            const remoteJid = c.remoteJid ?? c.id ?? "";
                            const fakeChat: Chat = { remoteJid, pushName: name };
                            setTab("conversas");
                            openChat(fakeChat);
                          }}
                        >
                          💬
                        </button>
                        <button
                          className="btn-ghost sm contact-chat-btn"
                          title="Enviar mensagem"
                          onClick={() => {
                            setNewMsgNumber(getContactNumber(c));
                            setNewMsgText("");
                            setNewMsgError("");
                            setNewMsgSuccess(false);
                            setNewMsgModal(true);
                          }}
                        >
                          ✉️
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/* CONVERSAS TAB                                         */}
      {/* ══════════════════════════════════════════════════════ */}
      {tab === "conversas" && (
        <div className="chats-layout">
          {/* Chat list */}
          <section className="chats-sidebar admin-section">
            <div className="chats-sidebar-header">
              <div className="search-input-wrap">
                <span className="search-icon">🔍</span>
                <input
                  type="search"
                  placeholder="Filtrar conversas…"
                  value={chatSearch}
                  onChange={(e) => setChatSearch(e.target.value)}
                  className="contacts-search-input"
                />
                {chatSearch && (
                  <button className="search-clear" onClick={() => setChatSearch("")}>✕</button>
                )}
              </div>
              <button
                className="btn-ghost sm"
                onClick={() => loadChats(token)}
                disabled={loadingChats}
                title="Atualizar conversas"
              >
                ↺
              </button>
            </div>

            {chatsError ? (
              <div className="error-message" style={{ margin: "0.75rem 1rem" }}>{chatsError}</div>
            ) : loadingChats ? (
              <div className="users-loading"><span className="spinner dark" />Carregando…</div>
            ) : filteredChats.length === 0 ? (
              <div className="empty-state" style={{ fontSize: "0.875rem" }}>
                {chatSearch ? "Nenhuma conversa encontrada." : "Nenhuma conversa. Verifique a conexão."}
              </div>
            ) : (
              <div className="chat-list">
                {filteredChats.map((ch, i) => {
                  const name = getChatName(ch);
                  const lastText = getLastMessageText(ch);
                  const ts = ch.lastMessage?.messageTimestamp ?? null;
                  const isActive = getChatId(activeChat ?? {}) === getChatId(ch);
                  return (
                    <button
                      key={i}
                      className={`chat-item${isActive ? " active" : ""}`}
                      onClick={() => openChat(ch)}
                    >
                      <div className="chat-item-avatar">
                        {ch.profilePictureUrl
                          ? <img src={ch.profilePictureUrl} alt={name} className="contact-avatar-img" />
                          : <span>{initials(name)}</span>
                        }
                        {(ch.unreadCount ?? 0) > 0 && (
                          <span className="unread-badge">{ch.unreadCount}</span>
                        )}
                      </div>
                      <div className="chat-item-body">
                        <div className="chat-item-top">
                          <span className="chat-item-name">{name}</span>
                          <span className="chat-item-ts">{formatTs(ts as number)}</span>
                        </div>
                        <div className="chat-item-preview">{lastText || <em>Sem mensagens</em>}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Messages panel */}
          <section className="messages-panel admin-section">
            {!activeChat ? (
              <div className="messages-empty">
                <div className="messages-empty-icon">💬</div>
                <p>Selecione uma conversa para ver as mensagens</p>
              </div>
            ) : (
              <>
                <div className="messages-header">
                  <div className="messages-header-avatar">
                    {activeChat.profilePictureUrl
                      ? <img src={activeChat.profilePictureUrl} alt={getChatName(activeChat)} className="contact-avatar-img" />
                      : <span>{initials(getChatName(activeChat))}</span>
                    }
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="messages-header-name">{getChatName(activeChat)}</div>
                    <div className="messages-header-sub">{getChatId(activeChat).replace(/@.*$/, "")}</div>
                  </div>
                  <button
                    className="btn-ghost sm"
                    title="Recarregar mensagens"
                    onClick={() => openChat(activeChat)}
                    disabled={loadingMessages}
                  >
                    ↺
                  </button>
                </div>

                <div className="messages-body">
                  {msgsError ? (
                    <div className="error-message" style={{ margin: "1rem" }}>{msgsError}</div>
                  ) : loadingMessages ? (
                    <div className="users-loading"><span className="spinner dark" />Carregando mensagens…</div>
                  ) : messages.length === 0 ? (
                    <div className="messages-empty" style={{ height: "100%" }}>
                      <p>Nenhuma mensagem encontrada nesta conversa.</p>
                    </div>
                  ) : (
                    <div className="messages-list">
                      {messages.map((m, i) => {
                        const fromMe = m.key?.fromMe ?? false;
                        const text = getMsgText(m);
                        const ts = m.messageTimestamp as number | undefined;
                        return (
                          <div key={i} className={`message-bubble${fromMe ? " from-me" : " from-them"}`}>
                            <div className="message-text">{text || <em>Mídia</em>}</div>
                            {ts && <div className="message-ts">{formatTs(ts)}</div>}
                          </div>
                        );
                      })}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>

                {/* ── Compose bar ───────────────────────────── */}
                <div className="compose-bar" onClick={() => setAttachMenuOpen(false)}>
                  {sendError && (
                    <div className="compose-error">
                      {sendError}
                      <button onClick={() => setSendError("")} className="compose-error-close">✕</button>
                    </div>
                  )}
                  <div className="compose-row">
                    <input ref={fileDocRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar,.csv" style={{ display: "none" }} onChange={(e) => handleFileSelected(e, "doc")} />
                    <input ref={fileMediaRef} type="file" accept="image/*,video/*" style={{ display: "none" }} onChange={(e) => handleFileSelected(e, "media")} />

                    <div className="compose-attach-wrap">
                      <button className="compose-attach-btn" title="Anexar" disabled={sendingMsg} onClick={(e) => { e.stopPropagation(); setAttachMenuOpen((v) => !v); }}>
                        +
                      </button>
                      {attachMenuOpen && (
                        <div className="compose-attach-menu" onClick={(e) => e.stopPropagation()}>
                          <button className="compose-attach-item" onClick={() => { setAttachMenuOpen(false); fileDocRef.current?.click(); }}>
                            <span className="compose-attach-icon">📄</span>Documento
                          </button>
                          <button className="compose-attach-item" onClick={() => { setAttachMenuOpen(false); fileMediaRef.current?.click(); }}>
                            <span className="compose-attach-icon">🖼️</span>Fotos e Vídeos
                          </button>
                        </div>
                      )}
                    </div>

                    <textarea
                      ref={composeRef}
                      className="compose-input"
                      placeholder="Enviar mensagem..."
                      value={msgText}
                      rows={1}
                      disabled={sendingMsg}
                      onChange={(e) => {
                        setMsgText(e.target.value);
                        e.target.style.height = "auto";
                        e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void handleSendText();
                        }
                      }}
                    />

                    <button className="compose-send-btn" disabled={sendingMsg || !msgText.trim()} onClick={() => void handleSendText()} title="Enviar">
                      {sendingMsg
                        ? <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
                        : <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                      }
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
