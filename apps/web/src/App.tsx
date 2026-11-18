import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { ArrowDown, ArrowLeft, ArrowUpRight, Bell, Check, CheckCheck, ChevronDown, CircleHelp, FilePlus2, LogOut, MessageCircle, Moon, MoreHorizontal, Paperclip, Plus, Search, Send, Smile, Sun, Users, X } from "lucide-react";
import { api, getAccessToken, setAccessToken } from "./api";
import type { Conversation, Message, User } from "./types";

type AuthResponse = { user: User; accessToken: string };
type UserListResponse = { users: User[] };
type ConversationListResponse = { conversations: Conversation[] };
type MessageListResponse = { messages: Message[] };
function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function Avatar({ user, size = "" }: { user?: User | null; size?: string }) {
  return <div className={`avatar ${size}`} aria-label={user?.displayName || "Chat"}>{user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(user?.displayName || "C")}</div>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState("");
  const [searchUsers, setSearchUsers] = useState<User[]>([]);
  const [modal, setModal] = useState<"new" | "group" | "profile" | "settings" | null>(null);
  const [groupTitle, setGroupTitle] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [profileDraft, setProfileDraft] = useState({ displayName: "", about: "" });
  const [dark, setDark] = useState(localStorage.getItem("chatind-theme") === "dark");
  const [mobileChat, setMobileChat] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<number | null>(null);
  const activeId = active?.id;
  const activeIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId || null;
  userIdRef.current = user?.id || null;

  const loadWorkspace = useCallback(async () => {
    const [{ user: current }, { conversations: chats }] = await Promise.all([
      api<{ user: User }>("/auth/me"),
      api<ConversationListResponse>("/conversations"),
    ]);
    setUser(current);
    setConversations(chats);
    setProfileDraft({ displayName: current.displayName, about: current.about || "" });
    setActive((previous) => previous ? chats.find((chat) => chat.id === previous.id) || previous : chats[0] || null);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL || "/api"}/auth/refresh`, { method: "POST", credentials: "include" });
        if (response.status === 401) return;
        if (!response.ok) {
          const result = await response.json().catch(() => ({ error: "Could not connect to Chatind" })) as { error?: string };
          throw new Error(result.error || "Could not connect to Chatind");
        }
        const result = await response.json() as AuthResponse;
        if (!alive) return;
        setAccessToken(result.accessToken);
        setUser(result.user);
        await loadWorkspace();
      } catch (reason) { if (alive) setError(reason instanceof Error ? reason.message : "Could not connect to Chatind"); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [loadWorkspace]);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("chatind-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    if (!user || !getAccessToken()) return;
    const apiBase = import.meta.env.VITE_API_BASE_URL || "/api";
    const socketOrigin = import.meta.env.VITE_SOCKET_URL || (apiBase.startsWith("http") ? new URL(apiBase).origin : window.location.origin);
    const connection = io(socketOrigin, { auth: { token: getAccessToken() }, path: "/socket.io" });
    setSocket(connection);
    connection.on("message:new", (message: Message) => {
      setConversations((old) => old.map((chat) => chat.id === message.conversationId ? { ...chat, updatedAt: message.createdAt, messages: [message] } : chat).sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)));
      if (message.conversationId === activeIdRef.current) {
        setMessages((old) => old.some((item) => item.id === message.id) ? old : [...old, message]);
        if (message.senderId !== userIdRef.current) connection.emit("message:read", { conversationId: message.conversationId, messageId: message.id });
      }
    });
    connection.on("message:read-receipt", (event: { messageId: string; userId: string; readAt: string }) => {
      setMessages((old) => old.map((message) => message.id === event.messageId
        ? { ...message, receipts: [...(message.receipts || []).filter((receipt) => receipt.userId !== event.userId), { userId: event.userId, readAt: event.readAt }] }
        : message));
    });
    connection.on("presence:snapshot", (userIds: string[]) => setOnlineUsers(new Set(userIds)));
    connection.on("presence:update", (event: { userId: string; online: boolean }) => {
      setOnlineUsers((old) => {
        const next = new Set(old);
        if (event.online) next.add(event.userId);
        else next.delete(event.userId);
        return next;
      });
    });
    connection.on("typing:start", (event: { conversationId: string; userId: string }) => {
      if (event.conversationId === activeIdRef.current && event.userId !== userIdRef.current) setTyping("typing…");
    });
    connection.on("typing:stop", (event: { conversationId: string }) => { if (event.conversationId === activeIdRef.current) setTyping(""); });
    connection.on("connect_error", (reason) => setError(`Live connection: ${reason.message}`));
    return () => { connection.disconnect(); setSocket(null); };
  }, [user?.id]);

  useEffect(() => {
    if (!activeId || !socket) return;
    let alive = true;
    setMessages([]);
    setTyping("");
    socket.emit("conversation:join", activeId, (result: { ok: boolean; error?: string }) => {
      if (!alive) return;
      if (!result.ok) setError(result.error || "Could not join conversation");
    });
    api<MessageListResponse>(`/conversations/${activeId}/messages`).then(({ messages: list }) => {
      if (alive) setMessages(list);
    }).catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : "Could not load messages"); });
    return () => { alive = false; };
  }, [activeId, socket]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, activeId]);

  useEffect(() => {
    const handler = (event: Event) => {
      const prompt = event as BeforeInstallPromptEvent;
      prompt.preventDefault();
      setInstallPrompt(prompt);
      setShowInstall(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const filtered = useMemo(() => {
    const value = query.toLowerCase().trim();
    return conversations.filter((chat) => {
      const label = chat.type === "GROUP" ? chat.title : chat.members.find((member) => member.userId !== user?.id)?.user.displayName;
      return !value || label?.toLowerCase().includes(value) || chat.messages[0]?.body.toLowerCase().includes(value);
    });
  }, [conversations, query, user?.id]);

  const activePeer = active?.members.find((member) => member.userId !== user?.id)?.user;

  async function submitAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const path = authMode === "login" ? "/auth/login" : "/auth/register";
    const body = authMode === "login"
      ? { username: form.get("username"), password: form.get("password") }
      : { username: form.get("username"), email: form.get("email"), password: form.get("password"), displayName: form.get("displayName") };
    try {
      const result = await api<AuthResponse>(path, { method: "POST", body: JSON.stringify(body) });
      setAccessToken(result.accessToken);
      setUser(result.user);
      await loadWorkspace();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not sign in"); }
  }

  async function logout() {
    try { await api("/auth/logout", { method: "POST" }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not log out"); }
    setAccessToken(null); setUser(null); setConversations([]); setActive(null); setMessages([]);
    socket?.disconnect(); setSocket(null);
  }

  async function sendMessage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !active) return;
    setDraft("");
    socket?.emit("typing:stop", { conversationId: active.id });
    try {
      await api(`/conversations/${active.id}/messages`, { method: "POST", body: JSON.stringify({ body }) });
      const { messages: latest } = await api<MessageListResponse>(`/conversations/${active.id}/messages`);
      setMessages(latest);
    } catch (reason) { setDraft(body); setError(reason instanceof Error ? reason.message : "Message was not sent"); }
  }

  async function searchForUsers(value: string) {
    setQuery(value);
    if (!value.trim()) { setSearchUsers([]); return; }
    try { const result = await api<UserListResponse>(`/users?search=${encodeURIComponent(value)}`); setSearchUsers(result.users); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Search failed"); }
  }

  async function startDirectChat(person: User) {
    try {
      const result = await api<{ conversation: Conversation }>("/conversations", { method: "POST", body: JSON.stringify({ type: "DIRECT", memberIds: [person.id] }) });
      setConversations((old) => [result.conversation, ...old.filter((chat) => chat.id !== result.conversation.id)]);
      setActive(result.conversation); setModal(null); setQuery(""); setSearchUsers([]); setMobileChat(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not start chat"); }
  }

  async function createGroup() {
    if (!groupTitle.trim() || !selectedUsers.length) return;
    try {
      const result = await api<{ conversation: Conversation }>("/conversations", { method: "POST", body: JSON.stringify({ type: "GROUP", title: groupTitle, memberIds: selectedUsers.map((person) => person.id) }) });
      setConversations((old) => [result.conversation, ...old]); setActive(result.conversation); setModal(null); setGroupTitle(""); setSelectedUsers([]); setMobileChat(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create group"); }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = await api<{ user: User }>("/users/me", { method: "PATCH", body: JSON.stringify(profileDraft) });
      setUser(result.user); setModal(null); setNotice("Profile updated");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save profile"); }
  }

  async function uploadFile(file?: File) {
    if (!file || !active) return;
    const form = new FormData(); form.set("file", file); form.set("conversationId", active.id);
    try {
      const result = await api<{ message: Message }>("/uploads", { method: "POST", body: form });
      setMessages((old) => [...old, result.message]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Upload failed"); }
  }

  function onDraft(value: string) {
    setDraft(value);
    if (!active || !socket) return;
    socket.emit("typing:start", { conversationId: active.id });
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => socket.emit("typing:stop", { conversationId: active.id }), 1200);
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    setInstallPrompt(null); setShowInstall(false);
  }

  if (loading) return <main className="loading-screen"><div className="brand-mark"><MessageCircle size={25} /></div><span>Opening your space…</span></main>;
  if (!user) return <AuthScreen mode={authMode} setMode={setAuthMode} onSubmit={submitAuth} error={error} />;

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileChat ? "sidebar-hidden-mobile" : ""}`}>
        <header className="sidebar-header">
          <div className="brand"><div className="brand-mark"><MessageCircle size={22} strokeWidth={2.5} /></div><span>chatind</span></div>
          <div className="header-actions">
            <button className="icon-btn" title="Create group" onClick={() => setModal("group")}><Users size={19} /></button>
            <button className="icon-btn" title="New conversation" onClick={() => { setModal("new"); setQuery(""); }}><Plus size={21} /></button>
            <button className="icon-btn" title="Settings" onClick={() => setModal("settings")}><MoreHorizontal size={21} /></button>
          </div>
        </header>
        <button className="profile-strip" onClick={() => setModal("profile")}>
          <Avatar user={user} /><span className="profile-copy"><b>{user.displayName}</b><small>@{user.username}</small></span><ChevronDown size={16} />
        </button>
        <div className="search-box"><Search size={17} /><input placeholder="Search conversations" value={query} onChange={(event) => void searchForUsers(event.target.value)} /><kbd>⌘ K</kbd></div>
        <div className="list-heading"><span>MESSAGES</span><button className="text-button" onClick={() => { setModal("new"); setQuery(""); }}>New chat</button></div>
        <div className="conversation-list">
          {searchUsers.length > 0 && query.trim() && <>
            <div className="list-heading search-title">PEOPLE</div>
            {searchUsers.map((person) => <button key={person.id} className="person-result" onClick={() => void startDirectChat(person)}><Avatar user={person} /><span><b>{person.displayName}</b><small>@{person.username}</small></span><ArrowUpRight size={16} /></button>)}
          </>}
          {filtered.map((chat) => {
            const peer = chat.members.find((member) => member.userId !== user.id)?.user;
            const title = chat.type === "GROUP" ? chat.title || "Group" : peer?.displayName || "Chat";
            const last = chat.messages[0];
            return <button key={chat.id} className={`conversation-item ${active?.id === chat.id ? "selected" : ""}`} onClick={() => { setActive(chat); setMobileChat(true); }}>
              <div className="avatar-wrap"><Avatar user={chat.type === "GROUP" ? undefined : peer} /><span className={`presence-dot ${peer && onlineUsers.has(peer.id) ? "online" : ""}`} /></div>
              <span className="conversation-copy"><span className="conversation-top"><b>{title}</b><time>{last ? timeLabel(last.createdAt) : ""}</time></span><span className="conversation-bottom"><small>{last ? `${last.sender.displayName === user.displayName ? "You: " : ""}${last.body}` : chat.type === "GROUP" ? `${chat.members.length} members` : "Start a conversation"}</small>{last && last.senderId !== user.id && <i className="unread-dot" />}</span></span>
            </button>;
          })}
          {!filtered.length && !searchUsers.length && <div className="empty-sidebar"><div className="empty-icon"><MessageCircle size={21} /></div><b>No conversations yet</b><span>Find someone and say hello.</span><button className="button button-outline" onClick={() => setModal("new")}>Start a chat</button></div>}
        </div>
        <footer className="sidebar-footer"><span><span className="online-indicator" /> All systems online</span><button title="Toggle theme" className="icon-btn" onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button></footer>
      </aside>
      <section className={`chat-panel ${mobileChat ? "chat-visible-mobile" : ""}`}>
        {active ? <>
          <header className="chat-header">
            <button className="icon-btn back-button" onClick={() => setMobileChat(false)} title="Back to conversations"><ArrowLeft size={20} /></button>
            <Avatar user={active.type === "GROUP" ? undefined : activePeer} />
            <div className="chat-heading"><b>{active.type === "GROUP" ? active.title : activePeer?.displayName}</b><span>{active.type === "GROUP" ? `${active.members.length} members · Group conversation` : activePeer && onlineUsers.has(activePeer.id) ? "Active now" : activePeer?.lastSeenAt ? `Last seen ${timeLabel(activePeer.lastSeenAt)}` : "Offline"}{typing && <i>{typing}</i>}</span></div>
            <button className="icon-btn" title="Search people" onClick={() => { setModal("new"); setQuery(""); }}><Search size={19} /></button>
            <button className="icon-btn" title="Chat details" onClick={() => setNotice(active.type === "GROUP" ? `Group members: ${active.members.map((member) => member.user.displayName).join(", ")}` : activePeer?.about || "No profile information yet.")}><MoreHorizontal size={21} /></button>
          </header>
          <div className="message-scroll">
            <div className="conversation-start"><span>THIS IS THE BEGINNING</span><b>{active.type === "GROUP" ? active.title : activePeer?.displayName}</b><small>Conversations are better when they’re yours.</small></div>
            {messages.map((message, index) => {
              const own = message.senderId === user.id;
              const same = index > 0 && messages[index - 1].senderId === message.senderId && new Date(message.createdAt).getTime() - new Date(messages[index - 1].createdAt).getTime() < 5 * 60_000;
              return <div key={message.id} className={`message-row ${own ? "own" : ""} ${same ? "same-sender" : ""}`}>
                {!own && !same && <Avatar user={message.sender} size="avatar-small" />}
                <div className="message-content">{active.type === "GROUP" && !own && !same && <small className="message-author">{message.sender.displayName}</small>}
                  <div className="bubble">{message.attachments?.map((attachment) => attachment.contentType.startsWith("image/") ? <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer"><img className="attachment-image" src={attachment.url} alt={attachment.originalName} /></a> : <a className="attachment-link" key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer"><FilePlus2 size={18} />{attachment.originalName}</a>)}<span>{message.body}</span></div>
                  <div className="message-meta"><time>{timeLabel(message.createdAt)}</time>{own && (message.receipts?.length ? <CheckCheck size={14} className="read-check" /> : <Check size={14} />)}</div>
                </div>
              </div>;
            })}
            {!messages.length && <div className="first-message"><span className="sparkle">✳</span><p>Every great conversation starts somewhere.</p><small>Send a message to get things going.</small></div>}
            <div ref={bottomRef} />
          </div>
          <form className="composer" onSubmit={(event) => void sendMessage(event)}>
            <label className="icon-btn attach-button" title="Attach file"><Paperclip size={19} /><input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,audio/webm,audio/mpeg,application/pdf" onChange={(event) => void uploadFile(event.target.files?.[0])} /></label>
            <input className="message-input" placeholder="Write a message…" value={draft} onChange={(event) => onDraft(event.target.value)} />
            <button type="button" className="icon-btn emoji-button" title="Add a smile" onClick={() => onDraft(`${draft}😊`)}><Smile size={19} /></button>
            <button type="submit" className="send-button" disabled={!draft.trim()} aria-label="Send message"><Send size={17} /></button>
          </form>
          <div className="composer-footnote">Messages are stored securely. <span>End-to-end encryption is not enabled.</span></div>
        </> : <div className="welcome-panel"><div className="welcome-art"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="welcome-mark"><MessageCircle size={43} /></div><span className="float-dot dot-one" /><span className="float-dot dot-two" /><span className="float-dot dot-three" /></div><h1>Your people,<br /><em>right here.</em></h1><p>A little more connected. A lot more you.</p><button className="button button-primary" onClick={() => { setModal("new"); setQuery(""); }}><Plus size={17} /> Start a conversation</button><small>Private by design. Here for the good stuff.</small></div>}
      </section>
      {error && <div className="toast error-toast" role="alert"><span>{error}</span><button onClick={() => setError("")}><X size={15} /></button></div>}
      {notice && <div className="toast notice-toast" role="status"><span>{notice}</span><button onClick={() => setNotice("")}><X size={15} /></button></div>}
      {showInstall && <div className="install-banner"><span>Take Chatind with you</span><button onClick={() => void installApp()}>Install</button><button onClick={() => setShowInstall(false)} aria-label="Dismiss"><X size={15} /></button></div>}
      {modal && <Modal onClose={() => setModal(null)} title={modal === "new" ? "Find your people" : modal === "group" ? "Create a group" : modal === "profile" ? "Your profile" : "Settings"}>
        {modal === "new" && <div className="modal-body"><p className="modal-description">Search Chatind by name or username to start a conversation.</p><div className="modal-search"><Search size={17} /><input autoFocus value={query} onChange={(event) => void searchForUsers(event.target.value)} placeholder="Try a name or @username" /></div>{searchUsers.map((person) => <button key={person.id} className="person-result modal-person" onClick={() => void startDirectChat(person)}><Avatar user={person} /><span><b>{person.displayName}</b><small>@{person.username}</small></span><ArrowUpRight size={16} /></button>)}{query && !searchUsers.length && <div className="modal-empty">No people found. Try another search.</div>}</div>}
        {modal === "group" && <div className="modal-body"><label className="field-label">Group name<input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} maxLength={80} placeholder="e.g. Weekend plans" /></label><label className="field-label">Add people<input placeholder="Search people" value={query} onChange={(event) => void searchForUsers(event.target.value)} /></label>{searchUsers.map((person) => <button key={person.id} className="person-result modal-person" onClick={() => setSelectedUsers((old) => old.some((item) => item.id === person.id) ? old.filter((item) => item.id !== person.id) : [...old, person])}><Avatar user={person} /><span><b>{person.displayName}</b><small>@{person.username}</small></span>{selectedUsers.some((item) => item.id === person.id) && <Check size={18} />}</button>)}<div className="selected-count">{selectedUsers.length} member{selectedUsers.length === 1 ? "" : "s"} selected</div><button className="button button-primary full-button" disabled={!groupTitle.trim() || !selectedUsers.length} onClick={() => void createGroup()}>Create group</button></div>}
        {modal === "profile" && <form className="modal-body" onSubmit={(event) => void saveProfile(event)}><div className="profile-edit-head"><Avatar user={user} size="avatar-large" /><span><b>@{user.username}</b><small>Your profile is visible to your contacts.</small></span></div><label className="field-label">Display name<input value={profileDraft.displayName} onChange={(event) => setProfileDraft({ ...profileDraft, displayName: event.target.value })} maxLength={80} required /></label><label className="field-label">About<textarea value={profileDraft.about} onChange={(event) => setProfileDraft({ ...profileDraft, about: event.target.value })} maxLength={140} rows={3} placeholder="A little about you…" /></label><button className="button button-primary full-button">Save changes</button></form>}
        {modal === "settings" && <div className="modal-body settings-body"><button className="settings-row" onClick={() => setDark(!dark)}>{dark ? <Sun size={18} /> : <Moon size={18} />}<span><b>Appearance</b><small>{dark ? "Dark theme" : "Light theme"}</small></span><span className="settings-action">{dark ? "Light" : "Dark"}</span></button><button className="settings-row" onClick={() => setNotice("Browser notifications can be enabled in your browser’s site settings.")}><Bell size={18} /><span><b>Notifications</b><small>Browser notification preferences</small></span><span className="settings-action">Manage</span></button><button className="settings-row" onClick={() => setNotice("Chatind stores messages on its service. End-to-end encryption is not enabled.")}><CircleHelp size={18} /><span><b>Privacy & security</b><small>Learn how your data is handled</small></span><ArrowDown size={16} /></button><button className="settings-row danger-row" onClick={() => void logout()}><LogOut size={18} /><span><b>Sign out</b><small>Sign out of this device</small></span></button><div className="settings-version">Chatind · conversations that feel closer</div></div>}
      </Modal>}
    </main>
  );
}

function timeLabel(value: string) {
  const date = new Date(value);
  const today = new Date().toDateString() === date.toDateString();
  return today ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card" role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><X size={19} /></button></header>{children}</section></div>;
}

function AuthScreen({ mode, setMode, onSubmit, error }: { mode: "login" | "register"; setMode: (mode: "login" | "register") => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void; error: string }) {
  return <main className="auth-page"><div className="auth-card"><div className="brand auth-brand"><div className="brand-mark"><MessageCircle size={22} /></div><span>chatind</span></div><div className="auth-intro"><span className="eyebrow">{mode === "login" ? "A GOOD PLACE TO CATCH UP" : "YOUR SPACE STARTS HERE"}</span><h1>{mode === "login" ? <>Good to<br /><em>see you.</em></> : <>Make room<br />for <em>hello.</em></>}</h1><p>{mode === "login" ? "Your conversations are right where you left them." : "Create your account and bring your people closer."}</p></div><form className="auth-form" onSubmit={onSubmit}>
    {mode === "register" && <label>Display name<input name="displayName" autoComplete="name" minLength={1} maxLength={80} placeholder="How should we call you?" required /></label>}
    <label>{mode === "login" ? "Username or email" : "Username"}<input name="username" autoComplete="username" minLength={mode === "register" ? 3 : 1} maxLength={254} placeholder={mode === "login" ? "maya or maya@example.com" : "Choose a username"} required /></label>
    {mode === "register" && <label>Email address<input name="email" type="email" autoComplete="email" placeholder="you@example.com" required /></label>}
    <label>Password<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "register" ? 10 : 1} maxLength={128} placeholder={mode === "register" ? "At least 10 characters" : "Your password"} required /></label>
    {error && <div className="auth-error" role="alert">{error}</div>}
    {mode === "login" && <span className="forgot-link">Password reset is not configured for this deployment.</span>}
    <button className="button button-primary auth-submit">{mode === "login" ? "Sign in" : "Create account"}<ArrowUpRight size={18} /></button>
  </form><div className="auth-switch">{mode === "login" ? "New around here?" : "Already have an account?"}<button onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Create an account" : "Sign in"}</button></div><div className="auth-privacy">By continuing, you agree to keep this a kind space.<span>Chatind is not end-to-end encrypted.</span></div></div><div className="auth-decoration"><div className="decor-ring ring-a" /><div className="decor-ring ring-b" /><div className="decor-ring ring-c" /><div className="decor-message message-a"><span className="mini-avatar">M</span><span><b>Maya Kapoor</b><small>Made it home 🌿</small></span><small>now</small></div><div className="decor-message message-b"><span className="mini-avatar coral">A</span><span><b>Arjun Mehta</b><small>That sounds perfect!</small></span><CheckCheck size={16} /></div><div className="decor-quote">“The best moments<br />are the ones <em>shared.”</em></div><span className="decor-spark">✳</span></div></main>;
}

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
