/* Shell: sidebar + topbar + role switcher + shared primitives.
   Mirrors apps/web/src/components/AppShell.tsx layout (sidebar L, topbar T). */

const { useState, useEffect, useRef, useMemo } = React;

/* ──────────────────────────────────────────────────────────────
   Icons — lucide-style minimal set
   ────────────────────────────────────────────────────────────── */
const I = {
  home:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12 12 3l9 9"/><path d="M5 10v10h14V10"/></svg>,
  message:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11 7.4L3 21l1.6-6A8 8 0 1 1 21 12Z"/></svg>,
  calendar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>,
  check:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m4 12 4 4 12-12"/></svg>,
  users:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  star:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>,
  clock:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
  folder:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z"/></svg>,
  poll:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>,
  sparkles: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3 11 8l5 2-5 2-2 5-2-5-5-2 5-2 2-5z"/><path d="M18 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"/></svg>,
  funnel:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>,
  card:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>,
  chart:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/></svg>,
  gear:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.3 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>,
  search:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>,
  bell:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>,
  plus:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>,
  chevron:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>,
  chevronD: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>,
  close:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>,
  more:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>,
  arrow:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>,
  info:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>,
  alert:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/></svg>,
  pin:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 17v5M9 3h6v4l2 4v2H7v-2l2-4V3z"/></svg>,
  upload:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>,
  mapPin:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 1 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
  wifiOff:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 1l22 22M16.7 16.7A11 11 0 0 0 12 15a11 11 0 0 0-4.7 1.7M5 13a15 15 0 0 1 4.2-2.2M19 13a15 15 0 0 0-5-2.8M2 8.8a20 20 0 0 1 5-2.5M22 8.8a20 20 0 0 0-8-3.5M12 20h.01"/></svg>,
  download: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>,
  sendTurn: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>,
  smile:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></svg>,
  paperclip:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.5a4 4 0 1 1 5.7 5.6l-8.6 8.5a2 2 0 0 1-2.8-2.8l7.9-7.8"/></svg>,
  hash:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></svg>,
  lock:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
  volumeX:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m23 9-6 6M17 9l6 6"/></svg>,
  flame:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3s-1-4 4-6z"/></svg>,
  reply:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>,
  qr:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3M17 17v4M21 14h-4M21 21h-4"/></svg>,
  eye:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  eyeOff:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.9 17.9A11 11 0 0 1 12 20C5 20 1 12 1 12a20 20 0 0 1 5.2-6M9.9 5A11 11 0 0 1 12 4c7 0 11 8 11 8a20 20 0 0 1-3.2 4.8M1 1l22 22M14.1 14.1A3 3 0 1 1 9.9 9.9"/></svg>,
  filter:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>,
  grip:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>,
  sun:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>,
  moon:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>,
  ledger:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h14l2 2v14l-2 2H4V4z"/><path d="M8 4v18M4 8h4M4 12h4M4 16h4"/></svg>,
};

/* ──────────────────────────────────────────────────────────────
   Avatar
   ────────────────────────────────────────────────────────────── */
function Avatar({ user, size, presence, ...rest }) {
  const cls = size === "sm" ? "avatar avatar--sm" : size === "lg" ? "avatar avatar--lg" : size === "xl" ? "avatar avatar--xl" : "avatar";
  return (
    <div className={cls} style={{ background: user.hue || "var(--primary)" }} title={user.name} {...rest}>
      {user.initials || (user.name || "?").split(" ").map(p => p[0]).slice(0,2).join("")}
      {presence && <span className={`avatar__presence avatar__presence--${user.presence || "offline"}`} />}
    </div>
  );
}

function AvatarStack({ users, max = 4, size = "sm" }) {
  const shown = users.slice(0, max);
  const more = users.length - shown.length;
  return (
    <div className="stack">
      {shown.map(u => <Avatar key={u.id} user={u} size={size} />)}
      {more > 0 && (
        <div className={`avatar ${size === "sm" ? "avatar--sm" : ""}`} style={{ background: "var(--bg-muted)", color: "var(--fg-muted)", fontWeight: 600 }}>
          +{more}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Sidebar
   ────────────────────────────────────────────────────────────── */
function ChapterLockup({ ctx }) {
  const { org } = ctx;
  const b = org.branding;
  const betaPill = org.beta.enabled && org.beta.style === "sidebar_pill";
  return (
    <div className="sidebar__chapter sidebar__chapter--lead">
      <div className="sidebar__chapter-crest" aria-hidden>{b.letters}</div>
      <div className="sidebar__chapter-meta">
        <div className="sidebar__chapter-line">
          <span className="sidebar__chapter-name" title={b.chapterName}>{b.chapterName}</span>
          {betaPill && <span className="beta-pill beta-pill--inline" title="Frapp is in private beta">BETA</span>}
        </div>
        <div className="sidebar__chapter-uni" title={`${b.chapterDesignation} chapter · ${b.school}`}>
          <span style={{ color: "var(--side-fg)" }}>{b.chapterDesignation}</span>
          <span className="dot-sep" />
          <span>{b.schoolShort}</span>
        </div>
      </div>
      <button className="sidebar__chapter-switch" title="Switch chapter (multi-chapter advisors only)">
        {React.cloneElement(I.chevronD, { style: { width: 14, height: 14 } })}
      </button>
    </div>
  );
}

function Sidebar({ ctx }) {
  const { route, setRoute, roleKey, org, currentUser } = ctx;

  // Module-key → nav-key map so we can gate routes by org config.
  // (nav keys that don't correspond to a module are always allowed.)
  const navKeyToModule = {
    chat: "chat", events: "events", tasks: "tasks", members: "members",
    points: "points", hours: "hours", backwork: "backwork", polls: "polls",
    onboarding: "onboarding", rush: "rush", billing: "billing", reports: "reports",
  };

  return (
    <aside className="sidebar">
      <ChapterLockup ctx={ctx} />

      <nav className="sidebar__nav">
        {window.NAV_CONFIG.map(section => {
          const visibleItems = section.items.filter(item => {
            if (item.capability && !window.hasCap(roleKey, item.capability)) return false;
            const mod = navKeyToModule[item.key];
            if (mod && !window.isModuleEnabled(org, mod)) return false;
            return true;
          });
          if (visibleItems.length === 0) return null;
          return (
            <div className="nav-section" key={section.label}>
              <div className="nav-section__label">{section.label}</div>
              {visibleItems.map(item => (
                <div
                  key={item.key}
                  className={`nav-item ${route === item.key ? "nav-item--active" : ""} ${item.status === "soon" ? "nav-item--disabled" : ""}`}
                  onClick={() => item.status !== "soon" && setRoute(item.key)}
                >
                  {I[item.icon] || I.folder}
                  <span>{item.label}</span>
                  {item.badge ? <span className="nav-item__badge">{item.badge}</span> :
                   item.status === "soon" ? <span className="nav-item__soon">Soon</span> :
                   item.status === "beta" ? <span className="nav-item__soon" style={{ background: "hsl(34 55% 68% / 0.16)", color: "var(--side-accent)" }}>Beta</span> :
                   null}
                </div>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="sidebar__user">
        <div className="sidebar__user-card">
          <Avatar user={currentUser} presence />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sidebar__user-name">{currentUser.name}</div>
            <div className="sidebar__user-role">{window.ROLES[currentUser.role].label}</div>
          </div>
          {React.cloneElement(I.gear, { style: { width: 14, height: 14, color: "var(--side-muted)" } })}
        </div>
      </div>
    </aside>
  );
}

/* ──────────────────────────────────────────────────────────────
   Topbar (breadcrumbs + search + role switcher + notifications)
   ────────────────────────────────────────────────────────────── */
function RoleSwitcher({ ctx }) {
  const { roleKey, setRoleKey } = ctx;
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const options = [
    { key: "president", desc: "Full admin: manage chapter, roles, events, billing" },
    { key: "treasurer", desc: "Finance: dues, invoices, adjustments" },
    { key: "vp",        desc: "Ops: events, tasks, onboarding" },
    { key: "member",    desc: "Active member: read/write chat, events, tasks" },
    { key: "newmember", desc: "Pledge: read-limited, onboarding pathway" },
  ];
  const current = window.ROLES[roleKey];
  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button
        className="btn"
        style={{ fontSize: 12.5, padding: "6px 10px" }}
        onClick={() => setOpen(!open)}
        title="Preview as a different role"
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: current.hue }} />
        <span>Viewing as: <strong>{current.label}</strong></span>
        {React.cloneElement(I.chevronD, { style: { width: 12, height: 12 }})}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, width: 320, zIndex: 50,
          background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius)",
          boxShadow: "var(--shadow-lg)", overflow: "hidden",
        }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--divider)", fontSize: 11, fontWeight: 700, color: "var(--fg-muted)", letterSpacing: "0.08em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 }}>
            {React.cloneElement(I.eye, { style: { width: 13, height: 13 }})} Role preview
          </div>
          {options.map(opt => {
            const r = window.ROLES[opt.key];
            const isActive = opt.key === roleKey;
            return (
              <div
                key={opt.key}
                onClick={() => { setRoleKey(opt.key); setOpen(false); }}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px",
                  cursor: "pointer", borderBottom: "1px solid var(--divider)",
                  background: isActive ? "var(--primary-soft)" : "transparent",
                }}
                onMouseEnter={e => !isActive && (e.currentTarget.style.background = "var(--bg-muted)")}
                onMouseLeave={e => !isActive && (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: r.hue, marginTop: 6, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)" }}>{r.label}</div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-muted)", marginTop: 2 }}>{opt.desc}</div>
                </div>
                {isActive && React.cloneElement(I.check, { style: { width: 14, height: 14, color: "var(--primary)", flexShrink: 0 }})}
              </div>
            );
          })}
          <div style={{ padding: 10, background: "var(--bg-muted)", fontSize: 11.5, color: "var(--fg-muted)" }}>
            Prototype only — in production, role is determined by the DB.
          </div>
        </div>
      )}
    </div>
  );
}

function Topbar({ ctx }) {
  const { route, offline, setOffline, org } = ctx;
  const routeLabel = useMemo(() => {
    for (const s of window.NAV_CONFIG) for (const it of s.items) if (it.key === route) return { section: s.label, label: it.label };
    return { section: "Chapter", label: route };
  }, [route]);

  const betaStyle = org.beta.enabled ? org.beta.style : null;

  return (
    <>
      {betaStyle === "top_banner" && <BetaTopBanner />}
      <header className="topbar">
        <div className="crumb">
          <span className="crumb__home">{React.cloneElement(I.home, { style: { width: 14, height: 14 }})}</span>
          <span>{routeLabel.section}</span>
          <span className="crumb__sep">/</span>
          <strong>{routeLabel.label}</strong>
          {betaStyle === "breadcrumb_pill" && (
            <span className="beta-pill beta-pill--crumb" title="Frapp is in private beta">BETA</span>
          )}
        </div>
        <div className="topbar__spacer" />

        <button className="topbar__search">
          {I.search}
          <span>Search members, events, docs…</span>
          <span className="topbar__search-kbd">⌘ K</span>
        </button>

        <RoleSwitcher ctx={ctx} />

        <button className="icon-btn" title="Toggle offline mode" onClick={() => setOffline(!offline)}>
          {offline ? I.wifiOff : I.info}
        </button>

        <button className="icon-btn" title="Notifications">
          {I.bell}
          <span className="icon-btn__dot" />
        </button>
      </header>
      {offline && (
        <div className="offline-banner">
          {React.cloneElement(I.wifiOff, { style: { width: 14, height: 14 }})}
          <strong>Offline mode.</strong>
          <span>You can read cached content and queue actions — they'll sync when you're back online.</span>
        </div>
      )}
    </>
  );
}

function BetaTopBanner() {
  return (
    <div className="beta-banner">
      <span className="beta-banner__dot" />
      <strong>Private beta.</strong>
      <span>You're on build 0.4.2 · pre-GA · features may shift week to week.</span>
      <a className="beta-banner__link" href="#feedback">Send feedback →</a>
    </div>
  );
}

function BetaCornerBadge({ ctx }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="beta-corner">
      <button className="beta-corner__btn" onClick={() => setOpen(!open)} title="Private beta — click for status">
        <span className="beta-corner__dot" />
        <span className="beta-corner__label">BETA · 0.4.2</span>
      </button>
      {open && (
        <div className="beta-corner__pop">
          <div className="beta-corner__row"><strong>Private beta</strong><span className="text-subtle">build 0.4.2</span></div>
          <div className="beta-corner__row text-muted text-sm">
            What works: Chat · Events · Tasks · Members · Backwork · Onboarding.
          </div>
          <div className="beta-corner__row text-muted text-sm">
            Rough edges: Billing reconciliation · Reports export · Rush funnel.
          </div>
          <div className="beta-corner__row">
            <button className="btn btn--sm" onClick={() => setOpen(false)}>Send feedback</button>
            <button className="btn btn--sm btn--ghost" onClick={() => setOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Shell wrapper
   ────────────────────────────────────────────────────────────── */
function Shell({ ctx, children }) {
  const cornerBeta = ctx.org.beta.enabled && ctx.org.beta.style === "corner_badge";
  return (
    <div className="app-root">
      <Sidebar ctx={ctx} />
      <main className="main">
        <Topbar ctx={ctx} />
        <div className="content">
          <div className="content__wrap">
            {children}
          </div>
        </div>
      </main>
      {cornerBeta && <BetaCornerBadge ctx={ctx} />}
      <TweaksPanelContainer ctx={ctx} />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Shared primitives: EmptyState, ErrorState, Loading, Proposed, Slideout
   ────────────────────────────────────────────────────────────── */
function EmptyState({ icon, title, body, action, kind = "empty" }) {
  return (
    <div className={`state ${kind === "error" ? "state--error" : ""}`}>
      <div className="state__icon">{icon || I.folder}</div>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
      {kind === "error" && <div className="state__reqid">req_7b2e4a · retry 2</div>}
    </div>
  );
}

function LoadingRows({ rows = 5, variant = "line" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 4 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {variant === "avatar" && <div className="skeleton" style={{ width: 36, height: 36, borderRadius: "50%" }} />}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <div className="skeleton" style={{ height: 12, width: `${60 + (i * 7) % 30}%` }} />
            <div className="skeleton" style={{ height: 10, width: `${35 + (i * 11) % 30}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Proposed({ note }) {
  return <span className="proposed-pill" title={note || "Proposed feature — beyond current spec"}>Proposed</span>;
}

function Slideout({ open, onClose, title, children, footer }) {
  if (!open) return null;
  return (
    <>
      <div className="slideout-overlay" onClick={onClose} />
      <div className="slideout">
        <div className="slideout__head">
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, flex: 1 }}>{title}</h3>
          <button className="icon-btn" onClick={onClose}>{I.close}</button>
        </div>
        <div className="slideout__body">{children}</div>
        {footer && <div className="slideout__foot">{footer}</div>}
      </div>
    </>
  );
}

function Modal({ open, onClose, title, children, footer, width }) {
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={width ? { maxWidth: width } : null} onClick={e => e.stopPropagation()}>
        <div className="modal__head">
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, flex: 1 }}>{title}</h3>
          <button className="icon-btn" onClick={onClose}>{I.close}</button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Tweaks — wired to org-config so users can switch archetype,
   toggle module visibility, change beta treatment, and swap the
   sidebar header layout. Persists via the host EDITMODE block.
   ────────────────────────────────────────────────────────────── */
function TweaksPanelContainer({ ctx }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const h = e => {
      if (e.data?.type === "__activate_edit_mode") setVisible(true);
      if (e.data?.type === "__deactivate_edit_mode") setVisible(false);
    };
    window.addEventListener("message", h);
    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", h);
  }, []);
  if (!visible) return null;

  const { tweaks, setTweaks, org, setOrg } = ctx;
  const update = (k, v) => {
    setTweaks(t => ({ ...t, [k]: v }));
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { [k]: v }}, "*");
  };

  // Archetype change rebuilds the whole config (the prototype's intent — in production
  // you'd merge carefully or do an irreversible setup wizard step).
  const onArchetype = (key) => {
    setOrg(window.makeOrgConfig(key));
    update("archetype", key);
  };
  const onBetaStyle = (style) => {
    setOrg(o => ({ ...o, beta: { ...o.beta, style }}));
    update("betaStyle", style);
  };
  const onBetaEnabled = (en) => {
    setOrg(o => ({ ...o, beta: { ...o.beta, enabled: en }}));
    update("betaEnabled", en);
  };
  const onModule = (mod, en) => {
    setOrg(o => ({ ...o, modules: { ...o.modules, [mod]: en }}));
  };

  return (
    <div className="tweaks">
      <div className="tweaks__head">
        <strong style={{ flex: 1, fontSize: 13, letterSpacing: "-0.01em" }}>Tweaks</strong>
        <button className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => { setVisible(false); window.parent.postMessage({ type: "__edit_mode_dismissed" }, "*"); }}>
          {React.cloneElement(I.close, { style: { width: 14, height: 14 }})}
        </button>
      </div>

      <div className="tweaks__body">

        <div className="tweaks__section">
          <div className="tweaks__label">Org archetype</div>
          <div className="tweaks__hint">Sets module presets, role vocabulary, dues cadence.</div>
          <select className="input" value={org.archetype} onChange={e => onArchetype(e.target.value)}>
            {Object.values(window.ORG_ARCHETYPES).map(a =>
              <option key={a.key} value={a.key}>{a.label}</option>
            )}
          </select>
        </div>

        <div className="tweaks__section">
          <div className="tweaks__label">Beta tag</div>
          <label className="tweaks__check">
            <input type="checkbox" checked={org.beta.enabled} onChange={e => onBetaEnabled(e.target.checked)} />
            Show beta indicator
          </label>
          <div className="tweaks__radio">
            {[
              ["sidebar_pill",   "Sidebar pill"],
              ["breadcrumb_pill", "Breadcrumb pill"],
              ["top_banner",     "Top banner"],
              ["corner_badge",   "Corner badge"],
            ].map(([k, lbl]) => (
              <label key={k} className={`tweaks__radio-opt ${org.beta.style === k ? "tweaks__radio-opt--active" : ""}`}>
                <input type="radio" name="betaStyle" checked={org.beta.style === k} onChange={() => onBetaStyle(k)} />
                {lbl}
              </label>
            ))}
          </div>
        </div>

        <div className="tweaks__section">
          <div className="tweaks__label">Modules</div>
          <div className="tweaks__hint">Top-level nav surfaces. Full per-feature config lives in Settings → Modules.</div>
          <div className="tweaks__modules">
            {window.MODULE_CATALOG.map(m => (
              <label key={m.key} className="tweaks__module">
                <input type="checkbox" checked={!!org.modules[m.key]} onChange={e => onModule(m.key, e.target.checked)} />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="tweaks__section">
          <div className="tweaks__label">Display</div>
          <label className="tweaks__check">
            <input type="checkbox" checked={tweaks.darkMode} onChange={e => update("darkMode", e.target.checked)} />
            Dark mode
          </label>
          <label className="tweaks__check">
            <input type="checkbox" checked={tweaks.showProposed} onChange={e => update("showProposed", e.target.checked)} />
            Show "Proposed" markers
          </label>
        </div>

      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Screen router — concrete screens live in home.jsx, chat.jsx,
   screens.jsx, screens2.jsx. Defensive stub for unwritten ones.
   ────────────────────────────────────────────────────────────── */
function ScreenRouter({ ctx }) {
  const { route } = ctx;
  const map = {
    home:       () => window.HomeScreen ? <window.HomeScreen ctx={ctx} /> : <StubScreen name="Home" />,
    chat:       () => window.ChatScreen ? <window.ChatScreen ctx={ctx} /> : <StubScreen name="Chat" />,
    events:     () => window.EventsScreen ? <window.EventsScreen ctx={ctx} /> : <StubScreen name="Events" />,
    tasks:      () => window.TasksScreen ? <window.TasksScreen ctx={ctx} /> : <StubScreen name="Tasks" />,
    members:    () => window.MembersScreen ? <window.MembersScreen ctx={ctx} /> : <StubScreen name="Members" />,
    points:     () => window.PointsScreen ? <window.PointsScreen ctx={ctx} /> : <StubScreen name="Points" />,
    hours:      () => window.HoursScreen ? <window.HoursScreen ctx={ctx} /> : <StubScreen name="Service hours" proposed />,
    backwork:   () => window.BackworkScreen ? <window.BackworkScreen ctx={ctx} /> : <StubScreen name="Backwork" />,
    polls:      () => <StubScreen name="Polls" proposed />,
    onboarding: () => window.OnboardingScreen ? <window.OnboardingScreen ctx={ctx} /> : <StubScreen name="Onboarding" />,
    rush:       () => window.RushScreen ? <window.RushScreen ctx={ctx} /> : <StubScreen name="Rush" proposed />,
    billing:    () => window.BillingScreen ? <window.BillingScreen ctx={ctx} /> : <StubScreen name="Billing" proposed />,
    reports:    () => window.ReportsScreen ? <window.ReportsScreen ctx={ctx} /> : <StubScreen name="Reports" proposed />,
    settings:   () => window.SettingsScreen ? <window.SettingsScreen ctx={ctx} /> : <StubScreen name="Settings" />,
  };
  const render = map[route] || (() => <StubScreen name={route} />);
  return <div className="screen-enter" key={route}>{render()}</div>;
}

function StubScreen({ name, proposed }) {
  return (
    <>
      <div className="ledger-line">
        <div className="ledger-line__dot" />
        <h1 className="h-display">{name} {proposed && <Proposed />}</h1>
      </div>
      <EmptyState
        title={`${name} — coming soon`}
        body="This screen hasn't been built yet in the prototype. Jump to Home, Chat, Events, Members, Tasks, Backwork, or Onboarding to see full designs."
      />
    </>
  );
}

Object.assign(window, { I, Avatar, AvatarStack, Shell, ScreenRouter, EmptyState, LoadingRows, Proposed, Slideout, Modal });
