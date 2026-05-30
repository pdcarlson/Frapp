/* Home — distinct composition per role.
   President: command center (chapter pulse, exec queue, approvals)
   Treasurer: money-focused (AR aging, dues drip, flagged members)
   VP: ops (tasks queue + upcoming events)
   Member: personal (next event, my tasks, chat catch-up, points)
   New member: pathway (walkthrough of the 8-week program)
*/

const { useState: useStateH, useEffect: useEffectH, useMemo: useMemoH } = React;

function HomeScreen({ ctx }) {
  const { currentUser, roleKey } = ctx;
  if (roleKey === "president")  return <HomePresident ctx={ctx} />;
  if (roleKey === "treasurer")  return <HomeTreasurer ctx={ctx} />;
  if (roleKey === "vp")         return <HomeVP ctx={ctx} />;
  if (roleKey === "newmember")  return <HomeNewMember ctx={ctx} />;
  return <HomeMember ctx={ctx} />;
}

/* ══════════════════ Shared bits ══════════════════ */
function HomeHeader({ title, sub, role, actions }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 24 }}>
      <div style={{ flex: 1 }}>
        <div className="eyebrow" style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--primary)" }} />
          {role}
        </div>
        <h1 className="h-display" style={{ fontSize: 28 }}>{title}</h1>
        {sub && <p style={{ color: "var(--fg-muted)", fontSize: 14, marginTop: 6, marginBottom: 0, maxWidth: 620 }}>{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

function Greeting() {
  const h = 10; // fixed for prototype
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/* ══════════════════ PRESIDENT ══════════════════ */
function HomePresident({ ctx }) {
  const { currentUser } = ctx;

  // Attention queue — things only the president can/should act on.
  const needsAction = [
    { id: "q1", kind: "approval", title: "Homecoming budget — final sign-off", detail: "Treasurer submitted $8,420. Vote closes Tuesday 7pm.", cta: "Review & vote", urgency: "high" },
    { id: "q2", kind: "confirm", title: "Task completion — Sam Rivera", detail: "'Send candidate list to nationals' awaiting confirmation.", cta: "Confirm", urgency: "med" },
    { id: "q3", kind: "risk", title: "3 members past due on Q2 dues", detail: "Priya flagged payment plan options for review.", cta: "Open treasury", urgency: "med" },
    { id: "q4", kind: "role", title: "Role assignment — rush chair", detail: "Diego is stepping down end of term. Pick a successor.", cta: "Assign", urgency: "low" },
  ];

  // Chapter pulse — aggregated signals
  const pulse = [
    { label: "Attendance (last 4 events)", value: "82%", delta: "+4 pts", good: true },
    { label: "Points leaderboard spread",   value: "148↔42", delta: "normal",    good: true },
    { label: "Q2 dues collected",            value: "76%", delta: "$5.2k outstanding", good: false },
    { label: "Active members (30d)",         value: "71 / 84", delta: "13 inactive", good: null },
  ];

  return (
    <>
      <HomeHeader
        role="President — Marcus Chen"
        title={`${Greeting()}, Marcus.`}
        sub="Here's what needs you today, and how the chapter is doing."
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn"><span>{I.plus}</span> New announcement</button>
            <button className="btn btn--primary"><span>{I.sendTurn}</span> Broadcast</button>
          </div>
        }
      />

      {/* Chapter pulse */}
      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        {pulse.map(p => (
          <div key={p.label} className="card card--flat" style={{ padding: 14 }}>
            <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>{p.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{p.value}</div>
            <div style={{ fontSize: 11.5, color: p.good === true ? "var(--success-text)" : p.good === false ? "var(--warn-text)" : "var(--fg-muted)", marginTop: 4 }}>
              {p.delta}
            </div>
          </div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
        {/* Needs you */}
        <div className="card">
          <div className="card__head">
            <h3>Needs you</h3>
            <div className="card__head-spacer" />
            <span className="chip chip--primary">{needsAction.length} items</span>
          </div>
          <div>
            {needsAction.map((q, i) => (
              <div key={q.id} style={{
                display: "flex", alignItems: "flex-start", gap: 14, padding: "16px 18px",
                borderBottom: i < needsAction.length - 1 ? "1px solid var(--divider)" : "none",
                cursor: "pointer", transition: "background 120ms",
              }} onMouseEnter={e => e.currentTarget.style.background = "var(--bg-muted)"}
                 onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <span style={{
                  width: 4, alignSelf: "stretch", borderRadius: 2, marginTop: 2, marginBottom: 2,
                  background: q.urgency === "high" ? "var(--danger)" : q.urgency === "med" ? "var(--warn)" : "var(--fg-subtle)",
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <span className="chip" style={{ textTransform: "uppercase", fontSize: 9.5, letterSpacing: "0.08em" }}>{q.kind}</span>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{q.title}</div>
                  </div>
                  <div style={{ color: "var(--fg-muted)", fontSize: 13 }}>{q.detail}</div>
                </div>
                <button className="btn btn--sm">{q.cta} {React.cloneElement(I.arrow, { style: { width: 12, height: 12 }})}</button>
              </div>
            ))}
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <UpcomingEventCard minimal />
          <ExecQueueCard />
        </div>
      </div>

      {/* Recent chapter activity */}
      <div style={{ marginTop: 24 }}>
        <ActivityFeed />
      </div>
    </>
  );
}

/* ══════════════════ TREASURER ══════════════════ */
function HomeTreasurer({ ctx }) {
  const { currentUser } = ctx;

  const ar = [
    { bucket: "Current", amount: 12400, members: 68, color: "var(--success)" },
    { bucket: "1–15 days", amount: 2100, members: 8, color: "var(--warn)" },
    { bucket: "16–30 days", amount: 1400, members: 5, color: "hsl(25 90% 55%)" },
    { bucket: "30+ days", amount: 1700, members: 3, color: "var(--danger)" },
  ];
  const arTotal = ar.reduce((s, b) => s + b.amount, 0);

  const flagged = [
    { memberId: "u_15", days: 47, amount: 620, note: "Alumni — graduated; waiver pending" },
    { memberId: "u_11", days: 32, amount: 540, note: "Payment plan requested" },
    { memberId: "u_12", days: 8,  amount: 580, note: "Reminded Apr 20" },
  ];

  return (
    <>
      <HomeHeader
        role="Treasurer — Priya Shah"
        title={`${Greeting()}, Priya.`}
        sub="$5.2k outstanding across 16 members. 3 need your attention."
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn">{I.download} Export Q2</button>
            <button className="btn btn--primary">{I.sendTurn} Send reminders</button>
          </div>
        }
      />

      {/* AR aging visualization */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card__head">
          <h3>Q2 Dues — Accounts Receivable</h3>
          <div className="card__head-spacer" />
          <span className="text-sm text-muted">As of Apr 23, 2026</span>
        </div>
        <div className="card__body">
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}>
              ${(arTotal / 1000).toFixed(1)}k
            </div>
            <div className="text-sm text-muted">total receivable · 84 invoices issued</div>
          </div>
          <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", marginBottom: 16 }}>
            {ar.map(b => (
              <div key={b.bucket} style={{ flex: b.amount, background: b.color }} title={`${b.bucket}: $${b.amount}`} />
            ))}
          </div>
          <div className="grid grid-4">
            {ar.map(b => (
              <div key={b.bucket}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: b.color }} />
                  <span className="text-xs text-muted" style={{ fontWeight: 500 }}>{b.bucket}</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>${b.amount.toLocaleString()}</div>
                <div className="text-xs text-muted">{b.members} members</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
        <div className="card">
          <div className="card__head">
            <h3>Flagged for follow-up</h3>
            <div className="card__head-spacer" />
            <span className="chip chip--warn">{flagged.length} members</span>
          </div>
          <div>
            {flagged.map((f, i) => {
              const m = window.memberOf(f.memberId);
              return (
                <div key={f.memberId} style={{
                  display: "flex", alignItems: "center", gap: 14, padding: "14px 18px",
                  borderBottom: i < flagged.length - 1 ? "1px solid var(--divider)" : "none",
                }}>
                  <Avatar user={m} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{m.name}</div>
                    <div className="text-xs text-muted">{f.note}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>${f.amount}</div>
                    <div className="text-xs" style={{ color: f.days > 30 ? "var(--danger-text)" : "var(--warn-text)" }}>
                      {f.days}d overdue
                    </div>
                  </div>
                  <button className="btn btn--sm">Plan</button>
                  <button className="btn btn--sm btn--primary">Remind</button>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="card">
            <div className="card__head"><h3>Points adjustments queue</h3></div>
            <div className="card__body">
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--fg-muted)", fontSize: 13 }}>
                {I.info}
                <span>No adjustments pending. Append-only ledger means each entry requires reason + officer signature.</span>
              </div>
              <button className="btn btn--sm" style={{ marginTop: 12 }}>
                {I.plus} Log adjustment
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card__head"><h3>Cashflow — next 30 days <Proposed /></h3></div>
            <div className="card__body">
              <CashflowMini />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function CashflowMini() {
  const bars = [
    { l: "Dues in",      v: 5200, dir: "in" },
    { l: "Social budget", v: 1800, dir: "out" },
    { l: "Philan event",  v: 2200, dir: "out" },
    { l: "House repairs", v: 600,  dir: "out" },
    { l: "Alumni gift",   v: 300,  dir: "in" },
  ];
  const max = Math.max(...bars.map(b => b.v));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {bars.map(b => (
        <div key={b.l} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 12, width: 100, color: "var(--fg-muted)" }}>{b.l}</div>
          <div style={{ flex: 1, height: 8, background: "var(--bg-muted)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${(b.v / max) * 100}%`, height: "100%", background: b.dir === "in" ? "var(--success)" : "var(--primary)" }} />
          </div>
          <div style={{ fontSize: 12, fontWeight: 500, width: 60, textAlign: "right", color: b.dir === "in" ? "var(--success-text)" : "var(--fg)" }}>
            {b.dir === "in" ? "+" : "−"}${b.v}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════ VP ══════════════════ */
function HomeVP({ ctx }) {
  const tasksOwned = window.TASKS_SEED.filter(t => t.assigneeIds.includes(ctx.currentUser.id));
  const tasksAssignedByMe = window.TASKS_SEED.filter(t => t.createdBy === ctx.currentUser.id || t.createdBy === "u_01").slice(0, 5);
  return (
    <>
      <HomeHeader
        role="Vice President — Jordan Webb"
        title={`${Greeting()}, Jordan.`}
        sub="You run operations: tasks, events, onboarding."
        actions={
          <button className="btn btn--primary">{I.plus} Create task</button>
        }
      />
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div className="card">
          <div className="card__head"><h3>Tasks you own</h3><div className="card__head-spacer" /><span className="chip">{tasksOwned.length}</span></div>
          <TaskMiniList tasks={tasksOwned} />
        </div>
        <div className="card">
          <div className="card__head"><h3>Delegated</h3><div className="card__head-spacer" /><span className="chip">{tasksAssignedByMe.length}</span></div>
          <TaskMiniList tasks={tasksAssignedByMe} showAssignee />
        </div>
      </div>
      <div className="hairline" />
      <UpcomingEventCard />
    </>
  );
}

function TaskMiniList({ tasks, showAssignee }) {
  if (!tasks || tasks.length === 0) {
    return <div style={{ padding: 20, textAlign: "center", color: "var(--fg-muted)", fontSize: 13 }}>Nothing here. 🎉</div>;
  }
  return (
    <div>
      {tasks.map((t, i) => {
        const assignees = t.assigneeIds.map(window.memberOf);
        const overdue = new Date(t.dueAt) < new Date("2026-04-23");
        return (
          <div key={t.id} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
            borderBottom: i < tasks.length - 1 ? "1px solid var(--divider)" : "none",
          }}>
            <span style={{
              width: 14, height: 14, borderRadius: 3, border: "1.5px solid var(--border-strong)", flexShrink: 0,
              background: t.status === "done" ? "var(--success)" : "transparent",
              display: "grid", placeItems: "center",
            }}>
              {t.status === "done" && <svg width="10" height="10" viewBox="0 0 10 10"><path d="m2 5 2 2 4-4" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500, textDecoration: t.status === "done" ? "line-through" : "none", color: t.status === "done" ? "var(--fg-subtle)" : "var(--fg)" }}>
                {t.title}
              </div>
              <div className="text-xs text-muted" style={{ marginTop: 2 }}>
                Due {window.formatDate(t.dueAt)} · +{t.points} pts · {t.category}
              </div>
            </div>
            {showAssignee && <AvatarStack users={assignees} size="sm" max={2} />}
            {overdue && t.status !== "done" && <span className="chip chip--danger">Overdue</span>}
            {t.status === "awaiting_confirm" && <span className="chip chip--warn">Awaiting confirm</span>}
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════ MEMBER ══════════════════ */
function HomeMember({ ctx }) {
  const { currentUser } = ctx;
  const myTasks = window.TASKS_SEED.filter(t => t.assigneeIds.includes(currentUser.id));
  const ledger = window.POINTS_LEDGER.filter(p => p.userId === currentUser.id);
  const myPoints = ledger.reduce((s, p) => s + p.delta, 0) + currentUser.id === "u_05" ? 143 : 67;

  return (
    <>
      <HomeHeader
        role={`Member — ${currentUser.name}`}
        title={`${Greeting()}, ${currentUser.name.split(" ")[0]}.`}
        sub="What's on your plate, and where the chapter's at."
      />

      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", gap: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <UpcomingEventCard memberView />
          <div className="card">
            <div className="card__head"><h3>Your tasks</h3><div className="card__head-spacer" /><a className="text-sm text-muted" style={{ cursor: "pointer" }}>View all</a></div>
            <TaskMiniList tasks={myTasks.slice(0, 4)} />
          </div>
          <ChatCatchupCard userId={currentUser.id} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <MyPointsCard userId={currentUser.id} />
          <div className="card">
            <div className="card__head"><h3>Chapter pulse</h3></div>
            <div className="card__body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <PulseRow label="Chapter meeting attendance" val="82%" />
              <PulseRow label="Your service hours this term" val="4 / 10" warn />
              <PulseRow label="New members in your bigship" val="2" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function PulseRow({ label, val, warn }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
      <span className="text-sm text-muted">{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: warn ? "var(--warn-text)" : "var(--fg)" }}>{val}</span>
    </div>
  );
}

function MyPointsCard({ userId }) {
  const ledger = window.POINTS_LEDGER.filter(p => p.userId === userId).slice(0, 3);
  const total = ledger.reduce((s, p) => s + p.delta, 0);
  return (
    <div className="card">
      <div className="card__head"><h3>Your points</h3><div className="card__head-spacer" /><span className="chip chip--primary">Rank #14 of 84</span></div>
      <div className="card__body" style={{ paddingTop: 6 }}>
        <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>{total > 0 ? 143 : 67}</div>
        <div className="text-xs text-muted" style={{ marginBottom: 14 }}>{total >= 0 ? "+" : ""}{total} this week · Goal 120</div>
        {ledger.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ledger.map(p => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                <span style={{
                  fontFamily: "var(--font-mono)", fontWeight: 600, width: 34, textAlign: "right",
                  color: p.delta > 0 ? "var(--success-text)" : "var(--danger-text)",
                }}>{p.delta > 0 ? "+" : ""}{p.delta}</span>
                <span style={{ flex: 1, color: "var(--fg)" }}>{p.reason}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted">No recent activity</div>
        )}
      </div>
    </div>
  );
}

function ChatCatchupCard({ userId }) {
  return (
    <div className="card">
      <div className="card__head"><h3>Chat catch-up</h3><div className="card__head-spacer" /><span className="chip">4 unread</span></div>
      <div>
        {[
          { chan: "general", auth: "Marcus Chen", msg: "Reminder: chapter meeting Tuesday 7pm. Homecoming budget vote — please read…", time: "2h", unread: 0 },
          { chan: "philanthropy-cmte", auth: "Diego Alvarez", msg: "5K planning — we need 2 more volunteers for registration table.", time: "30m", unread: 3 },
          { chan: "announcements", auth: "Jordan Webb", msg: "Nationals sent over the updated risk management policy. Required reading.", time: "1h", unread: 1 },
        ].map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 16px", borderBottom: i < 2 ? "1px solid var(--divider)" : "none", cursor: "pointer" }}>
            <div style={{ width: 20, height: 20, borderRadius: 3, background: "var(--bg-muted)", display: "grid", placeItems: "center", color: "var(--fg-muted)", flexShrink: 0 }}>
              {React.cloneElement(I.hash, { style: { width: 12, height: 12 }})}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <strong style={{ fontSize: 13 }}>{c.chan}</strong>
                <span className="text-xs text-muted">· {c.auth} · {c.time}</span>
              </div>
              <div className="text-sm text-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.msg}</div>
            </div>
            {c.unread > 0 && <span className="nav-item__badge" style={{ background: "var(--primary)" }}>{c.unread}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════ NEW MEMBER ══════════════════ */
function HomeNewMember({ ctx }) {
  const p = window.ONBOARDING_PATHWAY;
  const pct = Math.round((p.milestones.filter(m => m.status === "done").length / p.totalWeeks) * 100);

  return (
    <>
      <HomeHeader
        role="New Member — Gamma 2024"
        title={`${Greeting()}, Aiden.`}
        sub="You're in week 4 of 8. Here's your path to initiation."
      />

      <div className="card" style={{ marginBottom: 20, overflow: "hidden" }}>
        <div style={{ padding: "20px 20px 0" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <strong style={{ fontSize: 15 }}>New Member Pathway</strong>
            <span className="text-sm text-muted">Week {p.currentWeek} of {p.totalWeeks}</span>
            <div style={{ flex: 1 }} />
            <span className="chip chip--primary">{pct}% complete</span>
          </div>
          <div style={{ height: 6, background: "var(--bg-muted)", borderRadius: 3, marginTop: 12, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--primary)" }} />
          </div>
        </div>
        <div style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {p.milestones.map(m => {
            const isDone = m.status === "done";
            const isCurrent = m.status === "current";
            return (
              <div key={m.id} style={{
                padding: 14, borderRadius: "var(--radius)",
                border: `1px solid ${isCurrent ? "var(--primary)" : "var(--border)"}`,
                background: isDone ? "var(--success-soft)" : isCurrent ? "var(--primary-soft)" : "var(--bg-card)",
                position: "relative",
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                  Week {m.week}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: isDone ? "var(--success-text)" : "var(--fg)" }}>
                  {m.title}
                </div>
                <div style={{ marginTop: 8 }}>
                  {isDone && <span className="chip chip--success">{React.cloneElement(I.check, { style: { width: 10, height: 10 }})} Complete</span>}
                  {isCurrent && <span className="chip chip--primary"><span className="chip__dot pulse-dot" /> In progress</span>}
                  {m.status === "upcoming" && <span className="chip">Upcoming</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card__head"><h3>Your big / little</h3><div className="card__head-spacer" /></div>
          <div className="card__body" style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar user={window.memberOf("u_05")} size="xl" />
            <div>
              <div className="text-xs text-muted">Your Big</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Elena Park</div>
              <div className="text-sm text-muted">Beta 2023 · MechE · Junior</div>
              <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                <button className="btn btn--sm btn--primary">{I.message} Message</button>
                <button className="btn btn--sm">Schedule 1:1</button>
              </div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card__head"><h3>Your pledge class</h3><div className="card__head-spacer" /><span className="chip">5 members</span></div>
          <div className="card__body" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {p.newMembers.map(id => {
              const m = window.memberOf(id);
              return (
                <div key={id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar user={m} size="sm" presence />
                  <div style={{ flex: 1, fontSize: 13 }}>{m.name}</div>
                  <span className="text-xs text-muted">{m.major}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

/* ══════════════════ Shared cards ══════════════════ */
function UpcomingEventCard({ minimal, memberView }) {
  const next = window.EVENTS_SEED.find(e => !e.isPast);
  const hosts = next.hostIds.map(window.memberOf);
  return (
    <div className="card">
      <div className="card__head">
        <h3>{memberView ? "Your next event" : "Next up"}</h3>
        <div className="card__head-spacer" />
        <span className="chip">{next.category}</span>
      </div>
      <div className="card__body">
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <div style={{
            width: 60, textAlign: "center", flexShrink: 0,
            padding: "6px 0", borderRadius: "var(--radius-sm)", background: "var(--primary-soft)",
            border: "1px solid var(--primary-border)",
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--primary-hover)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {new Date(next.startsAt).toLocaleString(undefined, { month: "short" })}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--primary-hover)", lineHeight: 1.1, marginTop: 2 }}>
              {new Date(next.startsAt).getDate()}
            </div>
            <div style={{ fontSize: 10, color: "var(--primary-hover)", marginTop: 2 }}>
              {new Date(next.startsAt).toLocaleString(undefined, { weekday: "short" })}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{next.title}</div>
            <div className="text-sm text-muted" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              {React.cloneElement(I.clock, { style: { width: 13, height: 13 }})}
              {window.formatTime(next.startsAt)}–{window.formatTime(next.endsAt)}
              <span style={{ margin: "0 4px", color: "var(--fg-subtle)" }}>·</span>
              {React.cloneElement(I.mapPin, { style: { width: 13, height: 13 }})}
              {next.location}
            </div>
            {!minimal && <div className="text-sm" style={{ color: "var(--fg-muted)", marginTop: 8 }}>{next.description}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
              <AvatarStack users={hosts} size="sm" />
              <span className="text-xs text-muted">hosted by {hosts.map(h => h.name.split(" ")[0]).join(", ")}</span>
              <div style={{ flex: 1 }} />
              <span className="text-xs text-muted">{next.attendance.confirmed} going</span>
            </div>
            {memberView && (
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="btn btn--primary btn--sm">{I.check} I'll be there</button>
                <button className="btn btn--sm">Maybe</button>
                <button className="btn btn--sm btn--ghost">Can't make it</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ExecQueueCard() {
  return (
    <div className="card">
      <div className="card__head"><h3>Exec activity — 24h</h3></div>
      <div className="card__body" style={{ padding: 0 }}>
        {[
          { who: "u_02", what: "closed 4 invoices",         when: "2h" },
          { who: "u_03", what: "assigned 3 tasks",           when: "5h" },
          { who: "u_06", what: "created event Beach Cleanup", when: "1d" },
          { who: "u_04", what: "took meeting minutes",        when: "1d" },
          { who: "u_07", what: "granted 15 points",           when: "2d" },
        ].map((a, i) => {
          const m = window.memberOf(a.who);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: i < 4 ? "1px solid var(--divider)" : "none" }}>
              <Avatar user={m} size="sm" />
              <div style={{ flex: 1, fontSize: 13 }}>
                <strong>{m.name.split(" ")[0]}</strong> <span style={{ color: "var(--fg-muted)" }}>{a.what}</span>
              </div>
              <span className="text-xs text-muted">{a.when}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActivityFeed() {
  return (
    <div className="card">
      <div className="card__head"><h3>Chapter feed</h3><div className="card__head-spacer" /><span className="chip">Live</span></div>
      <div className="card__body">
        <div className="text-sm text-muted" style={{ textAlign: "center", padding: "20px 0" }}>
          Aggregated: chat activity, events RSVPs, task completions, points grants.
        </div>
      </div>
    </div>
  );
}

window.HomeScreen = HomeScreen;
