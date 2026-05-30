/* Members, Events, Tasks screens — three role views each where meaningful. */

const { useState: useStateS, useEffect: useEffectS, useMemo: useMemoS } = React;

/* ═══════════════════════════════════════════════════════════════
   MEMBERS
   ═══════════════════════════════════════════════════════════════ */
function MembersScreen({ ctx }) {
  const { roleKey, currentUser } = ctx;
  const [search, setSearch] = useStateS("");
  const [roleFilter, setRoleFilter] = useStateS("all");
  const [pledgeFilter, setPledgeFilter] = useStateS("all");
  const [view, setView] = useStateS("table"); // table | cards
  const [inviteOpen, setInviteOpen] = useStateS(false);
  const [selectedId, setSelectedId] = useStateS(null);

  const canInvite = window.hasCap(roleKey, "members.invite");
  const canAssignRole = window.hasCap(roleKey, "members.role.assign");

  const filtered = window.MEMBERS_SEED.filter(m => {
    if (search && !m.name.toLowerCase().includes(search.toLowerCase()) && !m.email.toLowerCase().includes(search.toLowerCase())) return false;
    if (roleFilter !== "all" && m.role !== roleFilter) return false;
    if (pledgeFilter !== "all" && m.pledgeClass !== pledgeFilter) return false;
    return true;
  });

  const pledgeClasses = [...new Set(window.MEMBERS_SEED.map(m => m.pledgeClass))];
  const roleCounts = window.MEMBERS_SEED.reduce((acc, m) => { acc[m.role] = (acc[m.role] || 0) + 1; return acc; }, {});
  const selected = selectedId ? window.MEMBERS_BY_ID[selectedId] : null;

  // Member (non-admin) view: simpler — no invite, no role controls, just directory
  const isAdmin = canInvite || canAssignRole;

  return (
    <>
      <div className="ledger-line">
        <div className="ledger-line__dot" />
        <h1 className="h-display" style={{ flex: 1 }}>Members</h1>
        <span className="text-sm text-muted">{filtered.length} of {window.MEMBERS_SEED.length}</span>
      </div>

      {/* Stats bar — admins only */}
      {isAdmin && (
        <div className="grid grid-4" style={{ marginBottom: 20 }}>
          <StatCard label="Total active" value={window.MEMBERS_SEED.filter(m => m.active).length} />
          <StatCard label="New members" value={roleCounts.newmember || 0} />
          <StatCard label="Exec board" value={(roleCounts.president || 0) + (roleCounts.vp || 0) + (roleCounts.treasurer || 0) + (roleCounts.secretary || 0) + (roleCounts.exec || 0)} />
          <StatCard label="Inactive / alumni" value={window.MEMBERS_SEED.filter(m => !m.active).length} dim />
        </div>
      )}

      {/* Toolbar */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ padding: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "5px 10px", background: "var(--bg-muted)", flex: 1, minWidth: 200 }}>
            {React.cloneElement(I.search, { style: { width: 14, height: 14, color: "var(--fg-muted)" }})}
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search members by name or email"
              style={{ border: "none", background: "transparent", outline: "none", flex: 1, fontSize: 13 }}
            />
          </div>
          <select className="select" value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={{ fontSize: 12.5, padding: "6px 10px" }}>
            <option value="all">All roles</option>
            {Object.keys(roleCounts).map(r => <option key={r} value={r}>{window.ROLES[r].label}</option>)}
          </select>
          <select className="select" value={pledgeFilter} onChange={e => setPledgeFilter(e.target.value)} style={{ fontSize: 12.5, padding: "6px 10px" }}>
            <option value="all">All classes</option>
            {pledgeClasses.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
            <button onClick={() => setView("table")} style={{ padding: "6px 10px", background: view === "table" ? "var(--bg-muted)" : "transparent", fontSize: 12 }}>Table</button>
            <button onClick={() => setView("cards")} style={{ padding: "6px 10px", background: view === "cards" ? "var(--bg-muted)" : "transparent", borderLeft: "1px solid var(--border)", fontSize: 12 }}>Cards</button>
          </div>
          {canInvite && (
            <button className="btn btn--primary" onClick={() => setInviteOpen(true)}>
              {React.cloneElement(I.plus, { style: { width: 14, height: 14 }})} Invite
            </button>
          )}
        </div>

        {/* Results */}
        {filtered.length === 0 ? (
          <EmptyState
            icon={I.users}
            title="No members match"
            body="Try clearing filters or a different search term."
            action={<button className="btn" onClick={() => { setSearch(""); setRoleFilter("all"); setPledgeFilter("all"); }}>Clear filters</button>}
          />
        ) : view === "table" ? (
          <MembersTable members={filtered} onSelect={setSelectedId} canAssignRole={canAssignRole} />
        ) : (
          <MembersCards members={filtered} onSelect={setSelectedId} />
        )}
      </div>

      {inviteOpen && <InviteModal onClose={() => setInviteOpen(false)} />}
      {selected && <MemberSlideout member={selected} onClose={() => setSelectedId(null)} canAssignRole={canAssignRole} viewer={currentUser} />}
    </>
  );
}

function StatCard({ label, value, dim }) {
  return (
    <div className="card card--flat" style={{ padding: 14 }}>
      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: dim ? "var(--fg-muted)" : "var(--fg)" }}>{value}</div>
    </div>
  );
}

function MembersTable({ members, onSelect, canAssignRole }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            <th>Pledge class</th>
            <th>Major</th>
            <th style={{ textAlign: "right" }}>Points</th>
            <th style={{ textAlign: "right" }}>Service hrs</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr key={m.id} onClick={() => onSelect(m.id)}>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar user={m} size="sm" presence />
                  <div>
                    <div style={{ fontWeight: 500 }}>{m.name}</div>
                    <div className="text-xs text-muted">{m.email}</div>
                  </div>
                </div>
              </td>
              <td><RoleBadge role={m.role} /></td>
              <td className="text-sm text-muted">{m.pledgeClass}</td>
              <td className="text-sm">{m.major}</td>
              <td style={{ textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 500 }}>{m.pointBalance}</td>
              <td style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>
                <span style={{ color: m.hoursThisTerm < 5 && m.role === "newmember" ? "var(--warn-text)" : "var(--fg)" }}>
                  {m.hoursThisTerm}
                </span>
              </td>
              <td>
                {m.active ? <span className="chip chip--success">Active</span> : <span className="chip">Alumni</span>}
              </td>
              <td style={{ textAlign: "right" }}>
                <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={e => { e.stopPropagation(); }}>
                  {React.cloneElement(I.more, { style: { width: 14, height: 14 }})}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MembersCards({ members, onSelect }) {
  return (
    <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
      {members.map(m => (
        <div key={m.id} onClick={() => onSelect(m.id)} style={{
          padding: 14, border: "1px solid var(--border)", borderRadius: "var(--radius)",
          background: "var(--bg-card)", cursor: "pointer",
          transition: "border-color 120ms, box-shadow 120ms",
        }} onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.boxShadow = "var(--shadow-sm)"; }}
           onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <Avatar user={m} size="lg" presence />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{m.name}</div>
              <div className="text-xs text-muted">{m.pledgeClass}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <RoleBadge role={m.role} />
          </div>
          <div className="text-xs text-muted">{m.major} · {m.year}</div>
          <div style={{ display: "flex", gap: 12, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--divider)" }}>
            <div><div className="text-xs text-muted">Pts</div><div style={{ fontWeight: 600, fontFamily: "var(--font-mono)" }}>{m.pointBalance}</div></div>
            <div><div className="text-xs text-muted">Hrs</div><div style={{ fontWeight: 600, fontFamily: "var(--font-mono)" }}>{m.hoursThisTerm}</div></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RoleBadge({ role }) {
  const r = window.ROLES[role];
  if (!r) return null;
  const isExec = ["president","vp","treasurer","secretary","exec","chair"].includes(role);
  return (
    <span className="chip" style={isExec ? { background: `color-mix(in oklch, ${r.hue} 15%, white)`, color: `color-mix(in oklch, ${r.hue} 70%, black)`, borderColor: `color-mix(in oklch, ${r.hue} 30%, white)` } : null}>
      <span className="chip__dot" style={{ background: r.hue }} />
      {r.label}
    </span>
  );
}

function InviteModal({ onClose }) {
  const [mode, setMode] = useStateS("single"); // single | bulk
  return (
    <Modal open onClose={onClose} title="Invite members" width={560}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn--primary">Send invites</button></>}>
      <div className="tabs" style={{ marginBottom: 16 }}>
        <div className={`tab ${mode === "single" ? "tab--active" : ""}`} onClick={() => setMode("single")}>Single</div>
        <div className={`tab ${mode === "bulk" ? "tab--active" : ""}`} onClick={() => setMode("bulk")}>Bulk (CSV)</div>
        <div className={`tab`} style={{ cursor: "not-allowed", opacity: 0.5 }}>QR link <Proposed /></div>
      </div>
      {mode === "single" ? (
        <>
          <div className="field">
            <label>Email</label>
            <input className="input" placeholder="jordan@stanford.edu" />
          </div>
          <div className="field">
            <label>Role at invite time</label>
            <select className="select" defaultValue="newmember">
              <option value="newmember">New Member (default for fall recruiting)</option>
              <option value="member">Active Member</option>
              <option value="exec">Exec</option>
            </select>
            <span className="field__help">You can change their role anytime after they join.</span>
          </div>
          <div className="field">
            <label>Pledge class</label>
            <input className="input" defaultValue="Gamma 2024" />
          </div>
          <div className="field">
            <label>Personal note (optional)</label>
            <textarea className="textarea" rows="2" placeholder="Welcome to Alpha Beta! Here's what to expect in your first week…" />
          </div>
        </>
      ) : (
        <>
          <div style={{ padding: 24, border: "2px dashed var(--border-strong)", borderRadius: "var(--radius)", textAlign: "center", background: "var(--bg-muted)" }}>
            {React.cloneElement(I.upload, { style: { width: 32, height: 32, color: "var(--fg-muted)", margin: "0 auto 8px", display: "block" }})}
            <div style={{ fontSize: 14, fontWeight: 600 }}>Drop a CSV here or click to browse</div>
            <div className="text-xs text-muted" style={{ marginTop: 4 }}>Columns: email, first_name, last_name, role, pledge_class</div>
          </div>
          <a className="text-sm" style={{ color: "var(--primary-hover)", marginTop: 12, display: "inline-block" }}>Download template</a>
        </>
      )}
    </Modal>
  );
}

function MemberSlideout({ member, onClose, canAssignRole, viewer }) {
  const [tab, setTab] = useStateS("overview");
  const tabs = ["overview", "points", "events", "tasks"];
  return (
    <Slideout open onClose={onClose} title="Member profile">
      <div style={{ textAlign: "center", paddingBottom: 20, borderBottom: "1px solid var(--divider)", marginBottom: 20 }}>
        <Avatar user={member} size="xl" presence />
        <div style={{ fontSize: 18, fontWeight: 600, marginTop: 10 }}>{member.name}</div>
        <div className="text-sm text-muted">{member.email}</div>
        <div style={{ marginTop: 10, display: "flex", justifyContent: "center", gap: 6 }}>
          <RoleBadge role={member.role} />
          <span className="chip">{member.pledgeClass}</span>
        </div>
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 12 }}>
          <button className="btn btn--sm btn--primary">{I.message} Message</button>
          {canAssignRole && viewer.id !== member.id && (
            <button className="btn btn--sm">Change role</button>
          )}
        </div>
      </div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        {tabs.map(t => (
          <div key={t} className={`tab ${tab === t ? "tab--active" : ""}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </div>
        ))}
      </div>
      {tab === "overview" && (
        <dl style={{ display: "grid", gridTemplateColumns: "120px 1fr", rowGap: 12, columnGap: 12, margin: 0, fontSize: 13.5 }}>
          <dt className="text-muted">Major</dt><dd style={{ margin: 0 }}>{member.major}</dd>
          <dt className="text-muted">Year</dt><dd style={{ margin: 0 }}>{member.year}</dd>
          <dt className="text-muted">Joined</dt><dd style={{ margin: 0 }}>{window.formatDate(member.joinedAt)}</dd>
          <dt className="text-muted">Phone</dt><dd style={{ margin: 0 }}>{member.phone}</dd>
          <dt className="text-muted">Status</dt><dd style={{ margin: 0 }}>{member.active ? "Active" : "Alumni / Inactive"}</dd>
          <dt className="text-muted">Points</dt><dd style={{ margin: 0, fontFamily: "var(--font-mono)" }}>{member.pointBalance}</dd>
          <dt className="text-muted">Service hrs</dt><dd style={{ margin: 0, fontFamily: "var(--font-mono)" }}>{member.hoursThisTerm}</dd>
        </dl>
      )}
      {tab === "points" && (
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
            <div style={{ fontSize: 32, fontWeight: 700 }}>{member.pointBalance}</div>
            <div className="text-sm text-muted">points · rank #{((member.id.charCodeAt(2) * 3) % 30) + 1}</div>
          </div>
          {window.POINTS_LEDGER.filter(p => p.userId === member.id).map(p => {
            const grantor = window.memberOf(p.grantedBy);
            return (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--divider)", fontSize: 13 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, width: 36, textAlign: "right", color: p.delta > 0 ? "var(--success-text)" : "var(--danger-text)" }}>
                  {p.delta > 0 ? "+" : ""}{p.delta}
                </span>
                <div style={{ flex: 1 }}>
                  <div>{p.reason}</div>
                  <div className="text-xs text-muted">by {grantor.name} · {window.formatDate(p.at)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {tab === "events" && (
        <div>
          <div className="text-sm text-muted" style={{ marginBottom: 10 }}>Attended 12 of 14 this term</div>
          {window.EVENTS_SEED.slice(0, 4).map(e => (
            <div key={e.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--divider)", fontSize: 13 }}>
              <div style={{ fontWeight: 500 }}>{e.title}</div>
              <div className="text-xs text-muted">{window.formatEventTime(e.startsAt)} · {e.category}</div>
            </div>
          ))}
        </div>
      )}
      {tab === "tasks" && (
        <div>
          {window.TASKS_SEED.filter(t => t.assigneeIds.includes(member.id)).map(t => (
            <div key={t.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--divider)", fontSize: 13 }}>
              <div style={{ fontWeight: 500 }}>{t.title}</div>
              <div className="text-xs text-muted">Due {window.formatDate(t.dueAt)} · {t.status}</div>
            </div>
          ))}
        </div>
      )}
    </Slideout>
  );
}

/* ═══════════════════════════════════════════════════════════════
   EVENTS
   ═══════════════════════════════════════════════════════════════ */
function EventsScreen({ ctx }) {
  const { roleKey } = ctx;
  const [view, setView] = useStateS("list"); // list | month | week
  const [openEventId, setOpenEventId] = useStateS(null);
  const [createOpen, setCreateOpen] = useStateS(false);
  const [filter, setFilter] = useStateS("upcoming"); // upcoming | past | mine
  const canCreate = window.hasCap(roleKey, "events.create");

  const events = window.EVENTS_SEED.filter(e => {
    if (filter === "upcoming") return !e.isPast;
    if (filter === "past") return e.isPast;
    if (filter === "mine") return true; // everything user is on — simplified
    return true;
  });

  const openEvent = openEventId ? window.EVENTS_BY_ID[openEventId] : null;

  return (
    <>
      <div className="ledger-line">
        <div className="ledger-line__dot" />
        <h1 className="h-display" style={{ flex: 1 }}>Events</h1>
        {canCreate && (
          <button className="btn btn--primary" onClick={() => setCreateOpen(true)}>
            {React.cloneElement(I.plus, { style: { width: 14, height: 14 }})} Create event
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div className="tabs" style={{ flex: 1, borderBottom: "none" }}>
          {[["upcoming","Upcoming"],["past","Past"],["mine","Mine"]].map(([k, l]) => (
            <div key={k} className={`tab ${filter === k ? "tab--active" : ""}`} onClick={() => setFilter(k)}>{l}</div>
          ))}
        </div>
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
          {["list","month","week"].map(v => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "6px 12px", background: view === v ? "var(--bg-muted)" : "var(--bg-card)", fontSize: 12, borderRight: v === "week" ? "" : "1px solid var(--border)", fontWeight: view === v ? 600 : 400 }}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={I.calendar}
          title="No events yet"
          body={filter === "past" ? "Past events will show up here after they happen." : "Nothing on the calendar. Create one to get the chapter together."}
          action={canCreate ? <button className="btn btn--primary" onClick={() => setCreateOpen(true)}>Create event</button> : null}
        />
      ) : view === "list" ? (
        <EventsList events={events} onOpen={setOpenEventId} ctx={ctx} />
      ) : view === "month" ? (
        <EventsCalendarMonth events={events} onOpen={setOpenEventId} />
      ) : (
        <EventsCalendarWeek events={events} onOpen={setOpenEventId} />
      )}

      {openEvent && <EventDetail event={openEvent} onClose={() => setOpenEventId(null)} ctx={ctx} />}
      {createOpen && <CreateEventModal onClose={() => setCreateOpen(false)} />}
    </>
  );
}

function EventsList({ events, onOpen, ctx }) {
  // Group by date
  const grouped = events.reduce((acc, e) => {
    const d = new Date(e.startsAt).toDateString();
    if (!acc[d]) acc[d] = [];
    acc[d].push(e);
    return acc;
  }, {});
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {Object.entries(grouped).map(([date, evts]) => (
        <div key={date}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{new Date(date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
            <div style={{ flex: 1, height: 1, background: "var(--divider)" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {evts.map(e => <EventListRow key={e.id} event={e} onOpen={onOpen} ctx={ctx} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function EventListRow({ event, onOpen, ctx }) {
  const hosts = event.hostIds.map(window.memberOf);
  const catColor = {
    "Mandatory": "var(--danger)",
    "Service": "var(--success)",
    "Social": "var(--hue-violet)",
    "New Member": "var(--hue-teal)",
    "Committee": "var(--hue-amber)",
    "House": "var(--primary)",
  }[event.category] || "var(--fg-muted)";
  return (
    <div onClick={() => onOpen(event.id)} style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "14px 18px", background: "var(--bg-card)",
      border: "1px solid var(--border)", borderRadius: "var(--radius)",
      cursor: "pointer", transition: "border-color 120ms, box-shadow 120ms",
    }} onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.boxShadow = "var(--shadow-sm)"; }}
       onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}>
      <div style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: catColor }} />
      <div style={{ width: 80, flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{window.formatTime(event.startsAt)}</div>
        <div className="text-xs text-muted">{window.formatTime(event.endsAt)}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <strong style={{ fontSize: 14 }}>{event.title}</strong>
          <span className="chip" style={{ background: "transparent", borderColor: catColor, color: catColor }}>{event.category}</span>
          {event.requiresCheckIn && <span className="chip chip--primary" style={{ fontSize: 10 }}>Check-in</span>}
        </div>
        <div className="text-xs text-muted" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          {React.cloneElement(I.mapPin, { style: { width: 11, height: 11 }})} {event.location} · +{event.points} pts{event.serviceHours ? ` · ${event.serviceHours}h service` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <AvatarStack users={hosts} size="sm" max={2} />
        <div className="text-xs text-muted" style={{ marginTop: 4 }}>{event.attendance.confirmed} going</div>
      </div>
    </div>
  );
}

function EventsCalendarMonth({ events, onOpen }) {
  // April 2026 grid
  const month = 3, year = 2026;
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const byDay = events.reduce((acc, e) => {
    const day = new Date(e.startsAt).getDate();
    if (new Date(e.startsAt).getMonth() !== month) return acc;
    if (!acc[day]) acc[day] = [];
    acc[day].push(e);
    return acc;
  }, {});

  return (
    <div className="card">
      <div style={{ padding: 14, display: "flex", alignItems: "center", gap: 8, borderBottom: "1px solid var(--divider)" }}>
        <button className="icon-btn" style={{ width: 30, height: 30 }}>{React.cloneElement(I.chevron, { style: { width: 14, height: 14, transform: "rotate(180deg)" }})}</button>
        <h3 className="h-section" style={{ flex: 1, textAlign: "center" }}>April 2026</h3>
        <button className="icon-btn" style={{ width: 30, height: 30 }}>{React.cloneElement(I.chevron, { style: { width: 14, height: 14 }})}</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", background: "var(--divider)", gap: 1 }}>
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
          <div key={d} style={{ padding: "8px 10px", background: "var(--bg-muted)", fontSize: 11, fontWeight: 700, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{d}</div>
        ))}
        {cells.map((d, i) => {
          const isToday = d === 23;
          return (
            <div key={i} style={{
              minHeight: 100, background: "var(--bg-card)", padding: 6,
              opacity: d ? 1 : 0.4,
            }}>
              {d && (
                <>
                  <div style={{
                    fontSize: 12, fontWeight: isToday ? 700 : 500,
                    color: isToday ? "var(--primary)" : "var(--fg)",
                    width: isToday ? 22 : "auto", height: isToday ? 22 : "auto",
                    borderRadius: isToday ? "50%" : 0,
                    background: isToday ? "var(--primary-soft)" : "transparent",
                    display: "grid", placeItems: "center",
                    marginBottom: 4,
                  }}>
                    {d}
                  </div>
                  {(byDay[d] || []).slice(0, 3).map(e => (
                    <div key={e.id} onClick={() => onOpen(e.id)} style={{
                      padding: "2px 6px", fontSize: 11, marginBottom: 2,
                      background: "var(--primary-soft)", color: "var(--primary-hover)",
                      borderRadius: 3, cursor: "pointer", fontWeight: 500,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {window.formatTime(e.startsAt).replace(":00", "")} {e.title}
                    </div>
                  ))}
                  {(byDay[d] || []).length > 3 && <div className="text-xs text-muted" style={{ fontSize: 10 }}>+{(byDay[d] || []).length - 3} more</div>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventsCalendarWeek({ events, onOpen }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="text-sm text-muted" style={{ textAlign: "center" }}>Week view — shows hourly grid with draggable events. Uses the same underlying data as month & list.</div>
    </div>
  );
}

function EventDetail({ event, onClose, ctx }) {
  const [checkInMode, setCheckInMode] = useStateS(false);
  const hosts = event.hostIds.map(window.memberOf);
  const canManage = window.hasCap(ctx.roleKey, "events.manage") || event.hostIds.includes(ctx.currentUser.id);
  const total = event.attendance.confirmed + event.attendance.declined + event.attendance.maybe;
  const checkedIn = event.attendance.checkedIn;
  const confirmed = event.attendance.confirmed;

  if (checkInMode) {
    return <CheckInMode event={event} onExit={() => setCheckInMode(false)} />;
  }

  return (
    <Modal open onClose={onClose} title={event.title} width={640}
      footer={
        canManage ? (
          <>
            <button className="btn btn--danger">Cancel event</button>
            <div style={{ flex: 1 }} />
            <button className="btn">Edit</button>
            {event.requiresCheckIn && <button className="btn btn--primary" onClick={() => setCheckInMode(true)}>{I.qr} Start check-in</button>}
          </>
        ) : (
          <>
            <button className="btn btn--ghost">Can't make it</button>
            <button className="btn">Maybe</button>
            <button className="btn btn--primary">{I.check} I'll be there</button>
          </>
        )
      }>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <span className="chip chip--primary">{event.category}</span>
        <span className="chip">+{event.points} points</span>
        {event.serviceHours && <span className="chip chip--success">{event.serviceHours}h service</span>}
        {event.requiresCheckIn && <span className="chip">Check-in required</span>}
        <span className="chip">Visibility: {event.visibility}</span>
      </div>
      <dl style={{ display: "grid", gridTemplateColumns: "100px 1fr", rowGap: 10, columnGap: 14, margin: 0, marginBottom: 20, fontSize: 13.5 }}>
        <dt className="text-muted">When</dt>
        <dd style={{ margin: 0 }}>{window.formatEventTime(event.startsAt)} – {window.formatTime(event.endsAt)}</dd>
        <dt className="text-muted">Where</dt>
        <dd style={{ margin: 0 }}>{event.location}</dd>
        <dt className="text-muted">Hosts</dt>
        <dd style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <AvatarStack users={hosts} size="sm" max={3} />
          <span>{hosts.map(h => h.name).join(", ")}</span>
        </dd>
      </dl>
      <p style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--fg-muted)", marginTop: 0 }}>{event.description}</p>

      <h4 className="h-section" style={{ marginTop: 20, marginBottom: 10 }}>Attendance</h4>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        <AttendanceStat n={confirmed} label="Going" color="var(--success)" />
        <AttendanceStat n={event.attendance.maybe} label="Maybe" color="var(--warn)" />
        <AttendanceStat n={event.attendance.declined} label="Declined" color="var(--fg-subtle)" />
        <AttendanceStat n={checkedIn} label="Checked in" color="var(--primary)" muted={!event.requiresCheckIn} />
      </div>

      {canManage && event.requiresCheckIn && event.isPast && (
        <div style={{ marginTop: 16, padding: 12, background: "var(--warn-soft)", border: "1px solid var(--warn-border)", borderRadius: "var(--radius)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--warn-text)" }}>
            {React.cloneElement(I.alert, { style: { width: 14, height: 14 }})}
            <strong>6 confirmed members didn't check in.</strong>
          </div>
          <button className="btn btn--sm" style={{ marginTop: 8 }}>Review & deduct points</button>
        </div>
      )}
    </Modal>
  );
}

function AttendanceStat({ n, label, color, muted }) {
  return (
    <div style={{ padding: 12, background: "var(--bg-muted)", borderRadius: "var(--radius-sm)", opacity: muted ? 0.5 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
        <span className="text-xs text-muted">{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{n}</div>
    </div>
  );
}

function CheckInMode({ event, onExit }) {
  const [checkedIds, setCheckedIds] = useStateS(new Set());
  const attendees = window.MEMBERS_SEED.slice(0, event.attendance.confirmed);
  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg-card)", zIndex: 200, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 12 }}>
        <button className="icon-btn" onClick={onExit}>{I.close}</button>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Live check-in — {event.title}</div>
          <div className="text-xs text-muted">{checkedIds.size} of {attendees.length} checked in · Live</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ padding: "10px 14px", background: "var(--primary-soft)", borderRadius: "var(--radius)", border: "1px solid var(--primary-border)", display: "flex", alignItems: "center", gap: 8 }}>
          {React.cloneElement(I.qr, { style: { width: 16, height: 16, color: "var(--primary-hover)" }})}
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--primary-hover)", fontWeight: 600, letterSpacing: "0.1em" }}>CHECKIN-47F2</code>
          <span className="text-xs text-muted">expires 8pm</span>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 300px", gap: 24 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <h3 className="h-section">Attendees</h3>
              <div style={{ flex: 1 }} />
              <input className="input" placeholder="Search" style={{ width: 200 }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
              {attendees.map(a => {
                const done = checkedIds.has(a.id);
                return (
                  <button key={a.id} onClick={() => {
                    const n = new Set(checkedIds);
                    if (n.has(a.id)) n.delete(a.id); else n.add(a.id);
                    setCheckedIds(n);
                  }} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                    background: done ? "var(--success-soft)" : "var(--bg-card)",
                    border: `1px solid ${done ? "var(--success-border)" : "var(--border)"}`,
                    borderRadius: "var(--radius)", textAlign: "left",
                    transition: "all 120ms",
                  }}>
                    <Avatar user={a} size="sm" />
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500 }}>{a.name}</div>
                    {done && React.cloneElement(I.check, { style: { width: 16, height: 16, color: "var(--success-text)" }})}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="card">
              <div className="card__head"><h3>Progress</h3></div>
              <div className="card__body">
                <div style={{ fontSize: 32, fontWeight: 700 }}>{checkedIds.size}<span style={{ fontSize: 16, fontWeight: 500, color: "var(--fg-muted)" }}>/{attendees.length}</span></div>
                <div style={{ height: 6, background: "var(--bg-muted)", borderRadius: 3, marginTop: 12, overflow: "hidden" }}>
                  <div style={{ width: `${(checkedIds.size / attendees.length) * 100}%`, height: "100%", background: "var(--success)", transition: "width 200ms" }} />
                </div>
                <div className="hairline" />
                <div className="text-sm text-muted" style={{ marginBottom: 8 }}>Absent:</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {attendees.filter(a => !checkedIds.has(a.id)).slice(0, 4).map(a => (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                      <Avatar user={a} size="sm" />
                      <span style={{ flex: 1 }}>{a.name}</span>
                      <button className="btn btn--sm btn--ghost" style={{ fontSize: 11, padding: "2px 6px" }}>Excuse</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="card" style={{ marginTop: 12 }}>
              <div className="card__head"><h3>QR code</h3></div>
              <div className="card__body">
                <div style={{ aspectRatio: "1", background: "white", border: "1px solid var(--border)", borderRadius: "var(--radius)", display: "grid", placeItems: "center", padding: 20 }}>
                  <FakeQRCode />
                </div>
                <div className="text-xs text-muted" style={{ textAlign: "center", marginTop: 8 }}>Members scan to self-check-in</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 24px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={onExit}>Pause</button>
        <button className="btn btn--primary">End check-in · auto-grant points</button>
      </div>
    </div>
  );
}

function FakeQRCode() {
  const seed = 42;
  const cells = [];
  for (let i = 0; i < 21; i++) for (let j = 0; j < 21; j++) {
    const filled = ((i * 31 + j * 17 + (i ^ j) * 13) % 5) < 2 || (i < 7 && j < 7) || (i < 7 && j > 13) || (i > 13 && j < 7);
    cells.push(filled);
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(21, 1fr)", gap: 0, width: 180, height: 180 }}>
      {cells.map((c, i) => <div key={i} style={{ aspectRatio: "1", background: c ? "black" : "white" }} />)}
    </div>
  );
}

function CreateEventModal({ onClose }) {
  const [step, setStep] = useStateS(1);
  return (
    <Modal open onClose={onClose} title="New event" width={580}
      footer={
        step === 1 ? <><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn--primary" onClick={() => setStep(2)}>Next</button></>
        : <><button className="btn" onClick={() => setStep(1)}>Back</button><button className="btn btn--primary">Create event</button></>
      }>
      <div style={{ display: "flex", gap: 2, marginBottom: 20 }}>
        {[1, 2].map(i => (
          <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: step >= i ? "var(--primary)" : "var(--bg-muted)" }} />
        ))}
      </div>
      {step === 1 ? (
        <>
          <div className="field"><label>Title</label><input className="input" placeholder="Chapter meeting" /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Starts</label><input className="input" type="datetime-local" defaultValue="2026-04-28T19:00" /></div>
            <div className="field"><label>Ends</label><input className="input" type="datetime-local" defaultValue="2026-04-28T20:30" /></div>
          </div>
          <div className="field"><label>Location</label><input className="input" placeholder="House Library" /></div>
          <div className="field"><label>Category</label>
            <select className="select"><option>Mandatory</option><option>Service</option><option>Social</option><option>New Member</option><option>Committee</option><option>House</option></select>
          </div>
        </>
      ) : (
        <>
          <div className="field"><label>Visibility</label>
            <select className="select"><option value="all">All chapter members</option><option value="committee">Committee only</option><option value="newmember">New members</option></select>
          </div>
          <div className="field">
            <label><input type="checkbox" defaultChecked /> Require check-in</label>
            <span className="field__help">Members scan QR or officer marks them present.</span>
          </div>
          <div className="field"><label>Points awarded</label><input className="input" type="number" defaultValue="5" /></div>
          <div className="field"><label>Service hours (if applicable)</label><input className="input" type="number" placeholder="0" /></div>
          <div className="field"><label>Description</label><textarea className="textarea" rows="3" placeholder="Weekly business + officer reports…" /></div>
        </>
      )}
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TASKS — Kanban + table
   ═══════════════════════════════════════════════════════════════ */
function TasksScreen({ ctx }) {
  const { roleKey, currentUser } = ctx;
  const [view, setView] = useStateS("board");
  const [scope, setScope] = useStateS("all"); // all | mine | delegated
  const [createOpen, setCreateOpen] = useStateS(false);
  const canAssign = window.hasCap(roleKey, "tasks.assign");
  const canConfirm = window.hasCap(roleKey, "tasks.confirm");

  let tasks = window.TASKS_SEED;
  if (scope === "mine") tasks = tasks.filter(t => t.assigneeIds.includes(currentUser.id));
  if (scope === "delegated") tasks = tasks.filter(t => t.createdBy === currentUser.id);

  return (
    <>
      <div className="ledger-line">
        <div className="ledger-line__dot" />
        <h1 className="h-display" style={{ flex: 1 }}>Tasks</h1>
        {canAssign && (
          <button className="btn btn--primary" onClick={() => setCreateOpen(true)}>
            {React.cloneElement(I.plus, { style: { width: 14, height: 14 }})} New task
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div className="tabs" style={{ flex: 1, borderBottom: "none" }}>
          {[["all","All tasks"],["mine","Assigned to me"],["delegated","I delegated"]].map(([k, l]) => (
            <div key={k} className={`tab ${scope === k ? "tab--active" : ""}`} onClick={() => setScope(k)}>{l}</div>
          ))}
        </div>
        <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
          {["board","table"].map(v => (
            <button key={v} onClick={() => setView(v)} style={{ padding: "6px 12px", background: view === v ? "var(--bg-muted)" : "var(--bg-card)", fontSize: 12 }}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {view === "board" ? <TaskBoard tasks={tasks} canConfirm={canConfirm} /> : <TaskTable tasks={tasks} />}
      {createOpen && <CreateTaskModal onClose={() => setCreateOpen(false)} />}
    </>
  );
}

function TaskBoard({ tasks, canConfirm }) {
  const cols = [
    { key: "todo", label: "To do", color: "var(--fg-muted)" },
    { key: "in_progress", label: "In progress", color: "var(--primary)" },
    { key: "awaiting_confirm", label: "Awaiting confirm", color: "var(--warn)" },
    { key: "done", label: "Done", color: "var(--success)" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
      {cols.map(c => {
        const ct = tasks.filter(t => t.status === c.key);
        return (
          <div key={c.key} style={{ background: "var(--bg-muted)", borderRadius: "var(--radius)", padding: 10, minHeight: 400 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px 10px" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.color }} />
              <strong style={{ fontSize: 12.5, flex: 1 }}>{c.label}</strong>
              <span className="text-xs text-muted">{ct.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ct.map(t => <TaskCard key={t.id} task={t} canConfirm={canConfirm} />)}
              {ct.length === 0 && (
                <div style={{ padding: 20, textAlign: "center", fontSize: 12, color: "var(--fg-subtle)" }}>
                  —
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskCard({ task, canConfirm }) {
  const assignees = task.assigneeIds.map(window.memberOf);
  const overdue = new Date(task.dueAt) < new Date("2026-04-23") && task.status !== "done";
  return (
    <div style={{
      padding: 12, background: "var(--bg-card)", border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)", cursor: "grab",
      transition: "border-color 120ms, box-shadow 120ms",
    }} onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.boxShadow = "var(--shadow-sm)"; }}
       onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{task.title}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span className="chip" style={{ fontSize: 10 }}>{task.category}</span>
        <span className="chip chip--primary" style={{ fontSize: 10 }}>+{task.points}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <AvatarStack users={assignees} size="sm" max={2} />
        <div style={{ flex: 1 }} />
        <span className="text-xs" style={{ color: overdue ? "var(--danger-text)" : "var(--fg-muted)" }}>
          {window.formatDate(task.dueAt)}
        </span>
      </div>
      {task.status === "awaiting_confirm" && canConfirm && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--divider)", display: "flex", gap: 4 }}>
          <button className="btn btn--sm" style={{ flex: 1, fontSize: 11 }}>Reject</button>
          <button className="btn btn--primary btn--sm" style={{ flex: 1, fontSize: 11 }}>Confirm</button>
        </div>
      )}
    </div>
  );
}

function TaskTable({ tasks }) {
  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr><th>Title</th><th>Assignee</th><th>Due</th><th>Points</th><th>Status</th></tr>
        </thead>
        <tbody>
          {tasks.map(t => (
            <tr key={t.id}>
              <td style={{ fontWeight: 500 }}>{t.title}</td>
              <td><AvatarStack users={t.assigneeIds.map(window.memberOf)} max={2} size="sm" /></td>
              <td className="text-sm text-muted">{window.formatDate(t.dueAt)}</td>
              <td style={{ fontFamily: "var(--font-mono)" }}>+{t.points}</td>
              <td><span className="chip">{t.status.replace("_", " ")}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreateTaskModal({ onClose }) {
  return (
    <Modal open onClose={onClose} title="New task" width={520}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn--primary">Create</button></>}>
      <div className="field"><label>Title</label><input className="input" placeholder="Book venue for alumni mixer" /></div>
      <div className="field"><label>Assign to</label>
        <select className="select"><option>Select member…</option>{window.MEMBERS_SEED.map(m => <option key={m.id}>{m.name}</option>)}</select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field"><label>Due</label><input className="input" type="date" /></div>
        <div className="field"><label>Points on completion</label><input className="input" type="number" defaultValue="5" /></div>
      </div>
      <div className="field"><label>Category</label>
        <select className="select"><option>Chapter</option><option>House</option><option>Events</option><option>Finance</option><option>Onboarding</option><option>Philanthropy</option></select>
      </div>
      <div className="field">
        <label><input type="checkbox" /> Require officer confirmation</label>
        <span className="field__help">If checked, completing the task sends it to an officer for confirmation before points are granted.</span>
      </div>
    </Modal>
  );
}

Object.assign(window, { MembersScreen, EventsScreen, TasksScreen });
