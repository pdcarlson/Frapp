/* Chat — full messaging surface.
   Matches /chat routes: channels, messages, reactions, pins, DMs, presence.
   Role-gated posting in `announcements` via postingRoles. */

const { useState: useStateC, useEffect: useEffectC, useRef: useRefC, useMemo: useMemoC } = React;

function ChatScreen({ ctx }) {
  const { currentUser, roleKey } = ctx;
  const [activeId, setActiveId] = useStateC("c_gen");
  const [threadParent, setThreadParent] = useStateC(null);
  const [state, setState] = useStateC("loaded"); // loaded | loading | empty | error

  const channels = useMemoC(() =>
    window.CHANNELS_SEED.filter(ch => !ch.visibility || ch.visibility.includes(roleKey)),
    [roleKey]
  );

  const active = channels.find(c => c.id === activeId) || channels[0];
  const messages = window.MESSAGES_SEED[active?.id] || [];

  return (
    <div style={{ margin: "-24px -32px -48px", height: "calc(100vh - 56px)", display: "flex", borderTop: "1px solid var(--border)" }}>
      <ChannelList channels={channels} activeId={active?.id} onSelect={setActiveId} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: "var(--bg)" }}>
        {state === "loading" && <ChatLoading />}
        {state === "error" && <ChatError onRetry={() => setState("loaded")} />}
        {state === "empty" && <ChatEmpty />}
        {state === "loaded" && active && (
          <>
            <ChannelHeader channel={active} setState={setState} />
            <MessageList messages={messages} onOpenThread={setThreadParent} />
            <Composer channel={active} roleKey={roleKey} />
          </>
        )}
      </div>
      {threadParent && (
        <ThreadPane parent={threadParent} onClose={() => setThreadParent(null)} />
      )}
    </div>
  );
}

/* ────────────────── Channel list ────────────────── */
function ChannelList({ channels, activeId, onSelect }) {
  const grouped = { channel: channels.filter(c => c.type === "channel"), dm: channels.filter(c => c.type === "dm") };
  return (
    <aside style={{
      width: 240, borderRight: "1px solid var(--border)",
      background: "var(--bg-card)", display: "flex", flexDirection: "column", flexShrink: 0,
    }}>
      <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid var(--divider)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 className="h-section">Chat</h3>
          <div style={{ flex: 1 }} />
          <button className="icon-btn" style={{ width: 26, height: 26 }} title="Browse channels">{React.cloneElement(I.plus, { style: { width: 14, height: 14 }})}</button>
        </div>
        <button style={{
          marginTop: 10, width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "6px 10px", fontSize: 12.5, color: "var(--fg-muted)",
          background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
        }}>
          {React.cloneElement(I.search, { style: { width: 13, height: 13 }})}
          Jump to…
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 0" }}>
        <ChannelSection label="Channels" items={grouped.channel} activeId={activeId} onSelect={onSelect} />
        <ChannelSection label="Direct messages" items={grouped.dm} activeId={activeId} onSelect={onSelect} />
      </div>
    </aside>
  );
}

function ChannelSection({ label, items, activeId, onSelect }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: "flex", alignItems: "center", padding: "4px 14px 4px",
        fontSize: 11, fontWeight: 700, color: "var(--fg-muted)",
        textTransform: "uppercase", letterSpacing: "0.1em",
      }}>
        <span style={{ flex: 1 }}>{label}</span>
      </div>
      {items.map(ch => {
        const active = ch.id === activeId;
        return (
          <div
            key={ch.id}
            onClick={() => onSelect(ch.id)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "6px 14px", marginLeft: 4, marginRight: 4,
              borderRadius: "var(--radius-sm)", cursor: "pointer",
              background: active ? "var(--primary-soft)" : "transparent",
              color: active ? "var(--primary-hover)" : "var(--fg)",
              fontWeight: active ? 600 : 400,
              transition: "background 120ms",
            }}
            onMouseEnter={e => !active && (e.currentTarget.style.background = "var(--bg-muted)")}
            onMouseLeave={e => !active && (e.currentTarget.style.background = "transparent")}
          >
            {ch.type === "dm" ? (
              <Avatar user={window.memberOf(ch.userId)} size="sm" />
            ) : (
              <span style={{ color: "var(--fg-subtle)", width: 16, display: "grid", placeItems: "center" }}>
                {ch.postingRoles ? React.cloneElement(I.lock, { style: { width: 13, height: 13 }}) : React.cloneElement(I.hash, { style: { width: 14, height: 14 }})}
              </span>
            )}
            <span style={{ flex: 1, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ch.name}</span>
            {ch.muted && React.cloneElement(I.volumeX, { style: { width: 12, height: 12, color: "var(--fg-subtle)" }})}
            {ch.unread > 0 && <span className="nav-item__badge" style={{ background: "var(--primary)" }}>{ch.unread}</span>}
          </div>
        );
      })}
    </div>
  );
}

/* ────────────────── Channel header ────────────────── */
function ChannelHeader({ channel, setState }) {
  const members = window.MEMBERS_SEED.slice(0, 8);
  const [showPinned, setShowPinned] = useStateC(false);
  const pinned = (window.MESSAGES_SEED[channel.id] || []).filter(m => m.pinned);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "12px 20px",
      background: "var(--bg-card)", borderBottom: "1px solid var(--border)",
    }}>
      {channel.type === "channel" ? (
        React.cloneElement(channel.postingRoles ? I.lock : I.hash, { style: { width: 18, height: 18, color: "var(--fg-muted)" }})
      ) : (
        <Avatar user={window.memberOf(channel.userId)} />
      )}
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
          {channel.name}
          {channel.postingRoles && <span className="chip chip--primary" style={{ fontSize: 10 }}>Admin-post</span>}
        </div>
        {channel.description && <div className="text-xs text-muted">{channel.description}</div>}
      </div>
      <div style={{ flex: 1 }} />
      {pinned.length > 0 && (
        <button className="btn btn--sm" onClick={() => setShowPinned(!showPinned)}>
          {I.pin} {pinned.length} pinned
        </button>
      )}
      <div style={{ display: "flex", alignItems: "center" }}>
        <AvatarStack users={members} size="sm" max={5} />
      </div>
      {/* Dev: state toggles */}
      <div style={{ marginLeft: 8, display: "flex", gap: 4, opacity: 0.6 }}>
        <button className="btn btn--sm btn--ghost" title="Simulate loading" onClick={() => { setState("loading"); setTimeout(() => setState("loaded"), 800); }} style={{ fontSize: 11 }}>⟳</button>
        <button className="btn btn--sm btn--ghost" title="Simulate error" onClick={() => setState("error")} style={{ fontSize: 11 }}>✕</button>
      </div>
      {showPinned && <PinnedPopover pinned={pinned} onClose={() => setShowPinned(false)} />}
    </div>
  );
}

function PinnedPopover({ pinned, onClose }) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
      <div style={{
        position: "absolute", top: 60, right: 20, width: 360, maxHeight: 400, overflowY: "auto",
        background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-lg)", zIndex: 41,
      }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--divider)", display: "flex", alignItems: "center", gap: 6 }}>
          {React.cloneElement(I.pin, { style: { width: 14, height: 14 }})}
          <strong style={{ fontSize: 13 }}>Pinned messages</strong>
        </div>
        {pinned.map(m => {
          const u = window.memberOf(m.authorId);
          return (
            <div key={m.id} style={{ padding: 14, borderBottom: "1px solid var(--divider)", display: "flex", gap: 10 }}>
              <Avatar user={u} size="sm" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{u.name}</div>
                <div style={{ fontSize: 12.5, color: "var(--fg-muted)", marginTop: 2 }}>{m.body}</div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ────────────────── Message list ────────────────── */
function MessageList({ messages, onOpenThread }) {
  const byDay = useMemoC(() => {
    const groups = [];
    let currentDate = null;
    messages.forEach(m => {
      const d = new Date(m.at).toDateString();
      if (d !== currentDate) {
        groups.push({ date: d, messages: [] });
        currentDate = d;
      }
      groups[groups.length - 1].messages.push(m);
    });
    return groups;
  }, [messages]);

  const scrollRef = useRefC();
  useEffectC(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  return (
    <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "16px 0" }}>
      {byDay.map(group => (
        <div key={group.date}>
          <DayDivider date={group.date} />
          {group.messages.map((m, i) => {
            const prev = i > 0 ? group.messages[i - 1] : null;
            const compact = prev && prev.authorId === m.authorId && (new Date(m.at) - new Date(prev.at)) / 1000 < 300 && !m.replyTo;
            return <MessageRow key={m.id} msg={m} compact={compact} onOpenThread={onOpenThread} />;
          })}
        </div>
      ))}
      <TypingIndicator />
    </div>
  );
}

function DayDivider({ date }) {
  const d = new Date(date);
  const today = new Date("2026-04-23").toDateString();
  const yest = new Date("2026-04-22").toDateString();
  let label = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  if (date === today) label = "Today";
  else if (date === yest) label = "Yesterday";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 24px", margin: "16px 0 8px" }}>
      <div style={{ flex: 1, height: 1, background: "var(--divider)" }} />
      <span style={{
        padding: "3px 10px", fontSize: 11, fontWeight: 600, color: "var(--fg-muted)",
        background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 999,
      }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: "var(--divider)" }} />
    </div>
  );
}

function MessageRow({ msg, compact, onOpenThread }) {
  const author = window.memberOf(msg.authorId);
  const [hover, setHover] = useStateC(false);
  const [localReactions, setLocalReactions] = useStateC(msg.reactions || []);

  const toggleReact = (emoji) => {
    const me = "u_05";
    setLocalReactions(rs => {
      const ex = rs.find(r => r.emoji === emoji);
      if (ex) {
        const mine = ex.by.includes(me);
        const by = mine ? ex.by.filter(b => b !== me) : [...ex.by, me];
        if (by.length === 0) return rs.filter(r => r.emoji !== emoji);
        return rs.map(r => r.emoji === emoji ? { ...r, by } : r);
      }
      return [...rs, { emoji, by: [me] }];
    });
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", gap: 12,
        padding: compact ? "2px 24px" : "8px 24px",
        paddingTop: compact ? 2 : 8,
        background: hover ? "var(--bg-muted)" : "transparent",
        position: "relative",
        transition: "background 80ms",
      }}
    >
      <div style={{ width: 36, flexShrink: 0 }}>
        {!compact ? (
          <Avatar user={author} />
        ) : (
          <div style={{ fontSize: 10, color: "var(--fg-subtle)", textAlign: "center", paddingTop: 4, opacity: hover ? 1 : 0 }}>
            {window.formatTime(msg.at).replace(" ", "")}
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {msg.replyTo && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--fg-muted)", marginBottom: 2 }}>
            {React.cloneElement(I.reply, { style: { width: 12, height: 12 }})}
            <span>replying to a message</span>
          </div>
        )}
        {!compact && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
            <strong style={{ fontSize: 14 }}>{author.name}</strong>
            <span style={{ fontSize: 11.5, color: "var(--fg-subtle)" }}>{window.formatTime(msg.at)}</span>
            {author.role !== "member" && author.role !== "newmember" && (
              <span className="chip" style={{ fontSize: 9.5, padding: "0 5px" }}>{window.ROLES[author.role].label}</span>
            )}
            {msg.pinned && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, color: "var(--fg-muted)" }}>
                {React.cloneElement(I.pin, { style: { width: 10, height: 10 }})} pinned
              </span>
            )}
          </div>
        )}
        <div style={{ fontSize: 14, lineHeight: 1.55, color: "var(--fg)" }}>{msg.body}</div>
        {localReactions.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
            {localReactions.map(r => {
              const iReacted = r.by.includes("u_05");
              return (
                <button
                  key={r.emoji}
                  onClick={() => toggleReact(r.emoji)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "2px 7px", fontSize: 12,
                    background: iReacted ? "var(--primary-soft)" : "var(--bg-muted)",
                    border: `1px solid ${iReacted ? "var(--primary-border)" : "var(--border)"}`,
                    borderRadius: 12, color: iReacted ? "var(--primary-hover)" : "var(--fg)",
                    transition: "background 120ms",
                  }}
                >
                  <span>{r.emoji}</span>
                  <span style={{ fontWeight: 600 }}>{r.by.length}</span>
                </button>
              );
            })}
            <button
              onClick={() => toggleReact("👍")}
              style={{
                display: "inline-flex", alignItems: "center", padding: "2px 7px", fontSize: 12,
                background: "transparent", border: "1px dashed var(--border)", borderRadius: 12,
                color: "var(--fg-muted)", opacity: 0.7,
              }}
            >
              {React.cloneElement(I.smile, { style: { width: 12, height: 12 }})}
            </button>
          </div>
        )}
      </div>
      {hover && (
        <div style={{
          position: "absolute", top: -14, right: 24,
          display: "flex", gap: 2, padding: 2,
          background: "var(--bg-card)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)", boxShadow: "var(--shadow-sm)",
        }}>
          {["👍", "🙏", "✅", "🔥"].map(e => (
            <button key={e} onClick={() => toggleReact(e)} style={{ padding: "4px 6px", fontSize: 14, borderRadius: 4, transition: "background 80ms" }}
              onMouseEnter={ev => ev.currentTarget.style.background = "var(--bg-muted)"}
              onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>
              {e}
            </button>
          ))}
          <div style={{ width: 1, background: "var(--divider)", margin: "4px 2px" }} />
          <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => onOpenThread(msg)}>
            {React.cloneElement(I.reply, { style: { width: 13, height: 13 }})}
          </button>
          <button className="icon-btn" style={{ width: 26, height: 26 }}>
            {React.cloneElement(I.pin, { style: { width: 13, height: 13 }})}
          </button>
          <button className="icon-btn" style={{ width: 26, height: 26 }}>
            {React.cloneElement(I.more, { style: { width: 13, height: 13 }})}
          </button>
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ padding: "6px 24px", fontSize: 12, color: "var(--fg-muted)", fontStyle: "italic", display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ display: "inline-flex", gap: 2 }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: 5, height: 5, borderRadius: "50%", background: "var(--fg-subtle)",
            animation: `typing 1.2s ease-in-out ${i * 0.16}s infinite`,
          }} />
        ))}
      </span>
      Diego is typing…
      <style>{`@keyframes typing { 0%, 60%, 100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-2px); } }`}</style>
    </div>
  );
}

/* ────────────────── Composer ────────────────── */
function Composer({ channel, roleKey }) {
  const [val, setVal] = useStateC("");
  const canPost = !channel.postingRoles || channel.postingRoles.includes(roleKey);

  if (!canPost) {
    return (
      <div style={{ padding: "16px 24px", background: "var(--bg-card)", borderTop: "1px solid var(--border)" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
          background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
          color: "var(--fg-muted)", fontSize: 13,
        }}>
          {React.cloneElement(I.lock, { style: { width: 14, height: 14 }})}
          Only <strong style={{ color: "var(--fg)" }}>{channel.postingRoles.map(r => window.ROLES[r].label).join(", ")}</strong> can post in #{channel.name}.
          You can still read and react.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "12px 20px 16px", background: "var(--bg-card)", borderTop: "1px solid var(--border)" }}>
      <div style={{
        border: "1px solid var(--border)", borderRadius: "var(--radius)",
        background: "var(--bg-input)", padding: 10,
        transition: "border-color 120ms, box-shadow 120ms",
      }}>
        <textarea
          className=""
          placeholder={`Message ${channel.type === "dm" ? channel.name : "#" + channel.name}`}
          value={val}
          onChange={e => setVal(e.target.value)}
          style={{
            width: "100%", minHeight: 40, resize: "none", border: "none", outline: "none",
            background: "transparent", fontSize: 14, lineHeight: 1.5, color: "var(--fg)",
            fontFamily: "inherit",
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6 }}>
          <button className="icon-btn" style={{ width: 30, height: 30 }} title="Attach">
            {React.cloneElement(I.paperclip, { style: { width: 15, height: 15 }})}
          </button>
          <button className="icon-btn" style={{ width: 30, height: 30 }} title="Emoji">
            {React.cloneElement(I.smile, { style: { width: 15, height: 15 }})}
          </button>
          <span className="text-xs text-muted" style={{ marginLeft: 4 }}>Shift+Enter for new line</span>
          <div style={{ flex: 1 }} />
          <button className="btn btn--primary btn--sm" disabled={!val.trim()} style={val.trim() ? {} : { opacity: 0.5, cursor: "not-allowed" }}>
            {React.cloneElement(I.sendTurn, { style: { width: 13, height: 13 }})} Send
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────── Thread pane ────────────────── */
function ThreadPane({ parent, onClose }) {
  const author = window.memberOf(parent.authorId);
  return (
    <aside style={{
      width: 380, borderLeft: "1px solid var(--border)", background: "var(--bg-card)",
      display: "flex", flexDirection: "column", flexShrink: 0,
    }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--divider)", display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 14, flex: 1 }}>Thread</strong>
        <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={onClose}>{React.cloneElement(I.close, { style: { width: 14, height: 14 }})}</button>
      </div>
      <div style={{ padding: "14px 16px", borderBottom: "4px solid var(--bg-muted)" }}>
        <div style={{ display: "flex", gap: 10 }}>
          <Avatar user={author} size="sm" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{author.name}</div>
            <div style={{ fontSize: 13, color: "var(--fg)", marginTop: 2 }}>{parent.body}</div>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
        <div className="text-xs text-muted" style={{ textAlign: "center", padding: 20 }}>
          No replies yet. Start the thread.
        </div>
      </div>
      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--divider)" }}>
        <input className="input" placeholder="Reply…" style={{ width: "100%" }} />
      </div>
    </aside>
  );
}

/* ────────────────── States ────────────────── */
function ChatLoading() {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "12px 20px", background: "var(--bg-card)", borderBottom: "1px solid var(--border)" }}>
        <div className="skeleton" style={{ width: 160, height: 16 }} />
      </div>
      <div style={{ flex: 1, padding: 20 }}>
        <LoadingRows rows={6} variant="avatar" />
      </div>
    </div>
  );
}
function ChatError({ onRetry }) {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 40 }}>
      <div style={{ maxWidth: 420, width: "100%" }}>
        <EmptyState
          kind="error"
          icon={I.alert}
          title="Couldn't load messages"
          body="Network error fetching #channel history. Your unsent messages are saved locally and will send when we're back."
          action={<button className="btn btn--primary" onClick={onRetry}>Retry</button>}
        />
      </div>
    </div>
  );
}
function ChatEmpty() {
  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 40 }}>
      <EmptyState
        icon={I.message}
        title="No messages yet"
        body="Be the first to post. Chapter members will be notified based on their preferences."
        action={<button className="btn btn--primary">Send the first message</button>}
      />
    </div>
  );
}

window.ChatScreen = ChatScreen;
