/* Rush, Billing, Service Hours, Reports screens. */

const { useState: useStateS3, useMemo: useMemoS3 } = React;

/* ═══════════════════════════ RUSH ═══════════════════════════ */
function RushScreen({ ctx }) {
  const { roleKey } = ctx;
  const canManage = window.hasCap(roleKey, "rush.manage") || window.hasCap(roleKey, "chapter.manage");
  const [view, setView] = useStateS3("funnel"); // funnel | ballot
  const [selected, setSelected] = useStateS3(null);

  if (!canManage) {
    return <window.EmptyState icon={window.I.lock} title="Officer access required" body="Rush is restricted to exec board + rush chair." />;
  }

  const stageCounts = {};
  window.RUSH_STAGES.forEach(s => { stageCounts[s.key] = 0; });
  window.RUSH_CANDIDATES.forEach(c => { stageCounts[c.stage]++; });

  const sel = selected ? window.RUSH_CANDIDATES.find(c => c.id === selected) : null;

  return (
    <>
      <div className="ledger-line">
        <div className="ledger-line__dot" />
        <h1 className="h-display" style={{ flex: 1 }}>Rush <window.Proposed note="Proposed — rush schema not yet in API" /></h1>
        <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--bg-muted)", borderRadius: "var(--radius-sm)" }}>
          <button className={`btn btn--sm ${view === "funnel" ? "btn--primary" : ""}`} style={{ border: "none" }} onClick={() => setView("funnel")}>Funnel</button>
          <button className={`btn btn--sm ${view === "ballot" ? "btn--primary" : ""}`} style={{ border: "none" }} onClick={() => setView("ballot")}>Bid ballot</button>
        </div>
        <button className="btn btn--primary">{React.cloneElement(window.I.plus, { style: { width: 14, height: 14 }})} Add candidate</button>
      </div>

      {view === "funnel" ? (
        <>
          <p className="text-sm text-muted" style={{ marginBottom: 20, maxWidth: 640 }}>
            Spring 2026 rush cohort. Drag candidates between stages, or click one to see references & notes.
          </p>
          {/* Funnel columns */}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${window.RUSH_STAGES.length}, 1fr)`, gap: 10, alignItems: "start" }}>
            {window.RUSH_STAGES.map(stage => {
              const cands = window.RUSH_CANDIDATES.filter(c => c.stage === stage.key);
              return (
                <div key={stage.key} style={{ background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", minHeight: 340 }}>
                  <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-card)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{stage.label}</span>
                      <span className="chip" style={{ fontSize: 10, marginLeft: "auto" }}>{cands.length}</span>
                    </div>
                    <div className="text-xs text-muted" style={{ fontSize: 10.5, marginTop: 2 }}>{stage.desc}</div>
                  </div>
                  <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    {cands.length === 0 && <div className="text-xs text-muted" style={{ padding: 16, textAlign: "center" }}>—</div>}
                    {cands.map(c => (
                      <div key={c.id} onClick={() => setSelected(c.id)} style={{
                        padding: 10, background: "var(--bg-card)", border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)", cursor: "pointer",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <div style={{ width: 22, height: 22, borderRadius: "50%", background: c.hue, color: "white", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 600, flexShrink: 0 }}>{c.initials}</div>
                          <span style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "var(--fg-muted)" }}>
                          <span>{c.year}</span>
                          <span>·</span>
                          <span>{c.major}</span>
                          {c.avgScore && <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontWeight: 600, color: c.avgScore >= 85 ? "var(--success-text)" : "var(--fg)" }}>{c.avgScore}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <RushBallot />
      )}

      {sel && (
        <window.Slideout open onClose={() => setSelected(null)} title={sel.name}
          footer={<><button className="btn">Move stage</button><div style={{ flex: 1 }} /><button className="btn btn--primary">Open profile</button></>}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: sel.hue, color: "white", display: "grid", placeItems: "center", fontSize: 20, fontWeight: 600 }}>{sel.initials}</div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 600 }}>{sel.name}</div>
              <div className="text-sm text-muted">{sel.year} · {sel.major}</div>
              <div className="text-xs text-muted" style={{ marginTop: 2 }}>{sel.email}</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 18 }}>
            <div style={{ padding: 12, background: "var(--bg-muted)", borderRadius: "var(--radius-sm)" }}>
              <div className="eyebrow">EVENTS ATTENDED</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{sel.eventsAttended}</div>
            </div>
            <div style={{ padding: 12, background: "var(--bg-muted)", borderRadius: "var(--radius-sm)" }}>
              <div className="eyebrow">AVG VOTE SCORE</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{sel.avgScore || "—"}</div>
            </div>
          </div>
          <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>References</h4>
          {sel.referrers.length === 0 ? <div className="text-sm text-muted">No references yet.</div> :
            <window.AvatarStack users={sel.referrers.map(id => window.memberOf(id))} max={6} />}
          <h4 style={{ margin: "18px 0 8px", fontSize: 13 }}>Notes</h4>
          {sel.flags.length === 0 ? <div className="text-sm text-muted">No notes yet.</div> :
            sel.flags.map((f, i) => (
              <div key={i} style={{ padding: "8px 10px", background: "var(--bg-muted)", borderRadius: "var(--radius-sm)", fontSize: 13, marginBottom: 6 }}>{f}</div>
            ))
          }
          <h4 style={{ margin: "18px 0 8px", fontSize: 13 }}>Add note</h4>
          <textarea className="textarea" rows="3" placeholder="Observations, references, red flags…" />
        </window.Slideout>
      )}
    </>
  );
}

function RushBallot() {
  const candidates = window.RUSH_CANDIDATES.filter(c => c.stage === "voting" || c.stage === "bid");
  const [votes, setVotes] = useStateS3({});
  return (
    <>
      <div style={{ padding: 14, background: "var(--warn-soft)", border: "1px solid var(--warn-border)", borderRadius: "var(--radius)", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
        {React.cloneElement(window.I.lock, { style: { width: 16, height: 16, color: "var(--warn-text)" }})}
        <div className="text-sm" style={{ color: "var(--warn-text)" }}>
          <strong>Anonymous ballot.</strong> Your votes are not linked to your identity in the audit log. Needs 2/3 to pass.
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {candidates.map(c => {
          const v = votes[c.id];
          return (
            <div key={c.id} className="card" style={{ padding: 14, display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: c.hue, color: "white", display: "grid", placeItems: "center", fontSize: 14, fontWeight: 600, flexShrink: 0 }}>{c.initials}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</div>
                <div className="text-xs text-muted">{c.year} · {c.major} · {c.eventsAttended} events attended · {c.referrers.length} references</div>
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {[
                  { k: "yes", label: "Yes", color: "var(--success)" },
                  { k: "no",  label: "No",  color: "var(--danger)" },
                  { k: "abstain", label: "Abstain", color: "var(--fg-muted)" },
                ].map(opt => (
                  <button key={opt.k} onClick={() => setVotes({ ...votes, [c.id]: opt.k })} className="btn btn--sm" style={{
                    border: v === opt.k ? `1.5px solid ${opt.color}` : "1px solid var(--border)",
                    background: v === opt.k ? `color-mix(in oklch, ${opt.color} 12%, var(--bg-card))` : "var(--bg-card)",
                    color: v === opt.k ? opt.color : "var(--fg)",
                    fontWeight: v === opt.k ? 600 : 400,
                  }}>{opt.label}</button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
        <button className="btn">Save draft</button>
        <button className="btn btn--primary" disabled={Object.keys(votes).length < candidates.length}>
          Submit ballot ({Object.keys(votes).length}/{candidates.length})
        </button>
      </div>
    </>
  );
}

/* ═══════════════════════════ BILLING ═══════════════════════════ */
function BillingScreen({ ctx }) {
  const { roleKey, currentUser } = ctx;
  const canManage = window.hasCap(roleKey, "billing.manage");
  const canView = window.hasCap(roleKey, "billing.view");

  // Member view: just their own dues
  if (!canView) {
    const mine = window.DUES_STATUS.find(d => d.userId === currentUser.id);
    return <BillingMemberView own={mine} currentUser={currentUser} />;
  }

  const totalOwed = window.DUES_STATUS.reduce((s, d) => s + d.amount - d.paidAmount, 0);
  const totalCollected = window.DUES_STATUS.reduce((s, d) => s + d.paidAmount, 0);
  const totalAmount = window.DUES_STATUS.reduce((s, d) => s + d.amount, 0);
  const pct = Math.round((totalCollected / totalAmount) * 100);

  return (
    <>
      <div className="ledger-line">
        <div className="ledger-line__dot" />
        <h1 className="h-display" style={{ flex: 1 }}>Billing <window.Proposed note="Proposed — Stripe Connect integration" /></h1>
        {canManage && <button className="btn">Export CSV</button>}
        {canManage && <button className="btn btn--primary">{React.cloneElement(window.I.plus, { style: { width: 14, height: 14 }})} New invoice</button>}
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <KPI label="Q2 TOTAL" value={`$${totalAmount.toLocaleString()}`} sub="across 16 members" />
        <KPI label="COLLECTED" value={`$${totalCollected.toLocaleString()}`} sub={`${pct}% of total`} tone="success" />
        <KPI label="OUTSTANDING" value={`$${totalOwed.toLocaleString()}`} sub={`${window.DUES_STATUS.filter(d => d.status === "pending" || d.status === "overdue" || d.status === "partial").length} members`} tone="warn" />
        <KPI label="OVERDUE" value={window.DUES_STATUS.filter(d => d.status === "overdue").length} sub="needs follow-up" tone="danger" />
      </div>

      {/* Progress */}
      <div className="card" style={{ padding: 16, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Spring 2026 dues collection</div>
            <div className="text-xs text-muted">Due May 15, 2026</div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-muted)" }}>
            ${totalCollected.toLocaleString()} / ${totalAmount.toLocaleString()}
          </div>
        </div>
        <div style={{ height: 8, background: "var(--bg-muted)", borderRadius: 4, overflow: "hidden", display: "flex" }}>
          <div style={{ width: `${(totalCollected / totalAmount) * 100}%`, background: "var(--success)" }} />
          <div style={{ width: `${(window.DUES_STATUS.filter(d => d.status === "plan").reduce((s, d) => s + d.amount, 0) / totalAmount) * 100}%`, background: "var(--warn)" }} />
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11.5, color: "var(--fg-muted)" }}>
          <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "var(--success)", marginRight: 5 }} />Paid</span>
          <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "var(--warn)", marginRight: 5 }} />On payment plan</span>
          <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "var(--bg-muted)", marginRight: 5, border: "1px solid var(--border)" }} />Unpaid</span>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="card__head"><h3>Per-member status</h3></div>
        <table className="table">
          <thead><tr><th>Member</th><th>Status</th><th>Amount</th><th>Paid</th><th>Due / Plan</th><th>Note</th><th></th></tr></thead>
          <tbody>
            {window.DUES_STATUS.map(d => {
              const m = window.memberOf(d.userId);
              const statusChip = {
                paid:    <span className="chip chip--success">Paid</span>,
                pending: <span className="chip">Pending</span>,
                overdue: <span className="chip" style={{ background: "var(--danger-soft)", color: "var(--danger-text)", borderColor: "var(--danger-border)" }}>Overdue</span>,
                plan:    <span className="chip" style={{ background: "var(--warn-soft)", color: "var(--warn-text)", borderColor: "var(--warn-border)" }}>Payment plan</span>,
                partial: <span className="chip" style={{ background: "var(--warn-soft)", color: "var(--warn-text)", borderColor: "var(--warn-border)" }}>Partial</span>,
                exempt:  <span className="chip">Exempt</span>,
              }[d.status];
              return (
                <tr key={d.userId}>
                  <td><div style={{ display: "flex", alignItems: "center", gap: 8 }}><window.Avatar user={m} size="sm" /><span style={{ fontSize: 13 }}>{m.name}</span></div></td>
                  <td>{statusChip}</td>
                  <td style={{ fontFamily: "var(--font-mono)" }}>${d.amount.toLocaleString()}</td>
                  <td style={{ fontFamily: "var(--font-mono)", color: d.paidAmount > 0 ? "var(--success-text)" : "var(--fg-muted)" }}>${d.paidAmount.toLocaleString()}</td>
                  <td className="text-xs text-muted">{d.paidAt ? `paid ${window.formatDate(d.paidAt)}` : d.dueAt ? `by ${window.formatDate(d.dueAt)}` : "—"}</td>
                  <td className="text-xs text-muted" style={{ maxWidth: 200 }}>{d.note || "—"}</td>
                  <td><button className="icon-btn" style={{ width: 26, height: 26 }}>{React.cloneElement(window.I.more, { style: { width: 13, height: 13 }})}</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BillingMemberView({ own, currentUser }) {
  if (!own) return <window.EmptyState icon={window.I.card} title="No invoices" body="You don't have any active invoices." />;
  const statusLabel = { paid: "Paid in full", pending: "Awaiting payment", overdue: "Overdue", plan: "On payment plan", partial: "Partially paid", exempt: "Exempt" }[own.status];
  const statusTone = own.status === "paid" ? "success" : own.status === "overdue" ? "danger" : "warn";
  return (
    <>
      <div className="ledger-line"><div className="ledger-line__dot" /><h1 className="h-display">Your dues</h1></div>
      <div className="card" style={{ padding: 24, marginBottom: 20 }}>
        <div className="eyebrow">SPRING 2026</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 6 }}>
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-0.02em" }}>${own.amount}</div>
          <span className={`chip chip--${statusTone === "success" ? "success" : ""}`} style={statusTone === "danger" ? { background: "var(--danger-soft)", color: "var(--danger-text)", borderColor: "var(--danger-border)" } : statusTone === "warn" ? { background: "var(--warn-soft)", color: "var(--warn-text)", borderColor: "var(--warn-border)" } : null}>{statusLabel}</span>
        </div>
        {own.note && <div className="text-sm text-muted" style={{ marginTop: 8 }}>{own.note}</div>}
        {own.status === "pending" && <button className="btn btn--primary" style={{ marginTop: 16 }}>Pay now</button>}
        {own.status === "overdue" && <>
          <div className="text-sm" style={{ color: "var(--danger-text)", marginTop: 12 }}>Your dues were due {window.formatDate(own.dueAt)}. Reach out to the Treasurer to set up a plan.</div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn btn--primary">Pay now</button>
            <button className="btn">Request payment plan</button>
          </div>
        </>}
      </div>
    </>
  );
}

function KPI({ label, value, sub, tone }) {
  const toneColor = { success: "var(--success-text)", warn: "var(--warn-text)", danger: "var(--danger-text)" }[tone] || "var(--fg)";
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="eyebrow">{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 4, color: toneColor }}>{value}</div>
      <div className="text-xs text-muted" style={{ marginTop: 2 }}>{sub}</div>
    </div>
  );
}

/* ═══════════════════════════ SERVICE HOURS ═══════════════════════════ */
function HoursScreen({ ctx }) {
  const { roleKey, currentUser } = ctx;
  const canApprove = window.hasCap(roleKey, "points.adjust") || window.hasCap(roleKey, "chapter.manage");
  const [tab, setTab] = useStateS3(canApprove ? "queue" : "mine");
  const [logOpen, setLogOpen] = useStateS3(false);

  const pending = window.HOURS_LOG.filter(h => h.status === "pending");
  const myHours = window.HOURS_LOG.filter(h => h.userId === currentUser.id);
  const myApproved = myHours.filter(h => h.status === "approved").reduce((s, h) => s + h.hours, 0);
  const req = window.HOURS_REQUIREMENTS[currentUser.role === "newmember" ? "newmember" : "member"];

  return (
    <>
      <div className="ledger-line">
        <div className="ledger-line__dot" />
        <h1 className="h-display" style={{ flex: 1 }}>Service hours <window.Proposed /></h1>
        <button className="btn btn--primary" onClick={() => setLogOpen(true)}>{React.cloneElement(window.I.plus, { style: { width: 14, height: 14 }})} Log hours</button>
      </div>

      {/* Own progress card */}
      {req && (
        <div className="card" style={{ padding: 16, marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
            <div>
              <div className="eyebrow">YOUR HOURS · {req.term}</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{myApproved} / {req.required}h</div>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ textAlign: "right", fontSize: 12, color: "var(--fg-muted)" }}>
              {myHours.filter(h => h.status === "pending").length > 0 && <div>{myHours.filter(h => h.status === "pending").length} pending review</div>}
              <div>{Math.max(0, req.required - myApproved)}h remaining</div>
            </div>
          </div>
          <div style={{ height: 8, background: "var(--bg-muted)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${Math.min(100, (myApproved / req.required) * 100)}%`, height: "100%", background: myApproved >= req.required ? "var(--success)" : "var(--primary)" }} />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 20 }}>
        {canApprove && <TabBtn active={tab === "queue"} onClick={() => setTab("queue")}>Approval queue ({pending.length})</TabBtn>}
        <TabBtn active={tab === "mine"} onClick={() => setTab("mine")}>My log</TabBtn>
        {canApprove && <TabBtn active={tab === "all"} onClick={() => setTab("all")}>All hours</TabBtn>}
      </div>

      {tab === "queue" && <HoursApprovalQueue />}
      {tab === "mine" && <HoursList hours={myHours} />}
      {tab === "all" && <HoursList hours={window.HOURS_LOG} showMember />}

      {logOpen && <LogHoursModal onClose={() => setLogOpen(false)} />}
    </>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: "10px 14px", background: "none", border: "none",
      borderBottom: `2px solid ${active ? "var(--primary)" : "transparent"}`,
      color: active ? "var(--fg)" : "var(--fg-muted)",
      fontWeight: active ? 600 : 400, fontSize: 13, cursor: "pointer", marginBottom: -1,
    }}>{children}</button>
  );
}

function HoursApprovalQueue() {
  const pending = window.HOURS_LOG.filter(h => h.status === "pending");
  if (pending.length === 0) return <window.EmptyState icon={window.I.check} title="Queue is clear" body="No hours awaiting review." />;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {pending.map(h => {
        const m = window.memberOf(h.userId);
        return (
          <div key={h.id} className="card" style={{ padding: 14 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <window.Avatar user={m} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <strong style={{ fontSize: 14 }}>{m.name}</strong>
                  <span className="chip" style={{ fontSize: 10 }}>{h.category}</span>
                  <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 700 }}>{h.hours}h</span>
                </div>
                <div style={{ fontSize: 13 }}>{h.description}</div>
                <div className="text-xs text-muted" style={{ marginTop: 4 }}>
                  {window.formatDate(h.at)} {h.receipt && <>· 📎 {h.receipt}</>}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--divider)" }}>
              <button className="btn btn--sm">Ask for details</button>
              <div style={{ flex: 1 }} />
              <button className="btn btn--sm" style={{ color: "var(--danger-text)" }}>Reject</button>
              <button className="btn btn--sm btn--primary">{React.cloneElement(window.I.check, { style: { width: 12, height: 12 }})} Approve</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HoursList({ hours, showMember }) {
  if (hours.length === 0) return <window.EmptyState icon={window.I.clock} title="No hours logged yet" body="Click 'Log hours' to add some." />;
  return (
    <div className="card">
      <table className="table">
        <thead><tr>{showMember && <th>Member</th>}<th>Description</th><th>Category</th><th>Hours</th><th>Date</th><th>Status</th></tr></thead>
        <tbody>
          {hours.map(h => {
            const m = window.memberOf(h.userId);
            const chip = {
              approved: <span className="chip chip--success">Approved</span>,
              pending: <span className="chip" style={{ background: "var(--warn-soft)", color: "var(--warn-text)", borderColor: "var(--warn-border)" }}>Pending</span>,
              rejected: <span className="chip" style={{ background: "var(--danger-soft)", color: "var(--danger-text)", borderColor: "var(--danger-border)" }}>Rejected</span>,
            }[h.status];
            return (
              <tr key={h.id}>
                {showMember && <td><div style={{ display: "flex", alignItems: "center", gap: 6 }}><window.Avatar user={m} size="sm" /><span style={{ fontSize: 13 }}>{m.name}</span></div></td>}
                <td className="text-sm">{h.description}</td>
                <td><span className="chip" style={{ fontSize: 10 }}>{h.category}</span></td>
                <td style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{h.hours}h</td>
                <td className="text-xs text-muted">{window.formatDate(h.at)}</td>
                <td>{chip}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LogHoursModal({ onClose }) {
  return (
    <window.Modal open onClose={onClose} title="Log service hours" width={480}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn--primary">Submit for review</button></>}>
      <div className="field"><label>Description</label><input className="input" placeholder="Tutoring at Boys & Girls Club" /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field"><label>Category</label><select className="select"><option>Service</option><option>Philanthropy</option><option>Chapter</option></select></div>
        <div className="field"><label>Hours</label><input className="input" type="number" step="0.5" defaultValue="2" /></div>
      </div>
      <div className="field"><label>Date</label><input className="input" type="date" /></div>
      <div className="field"><label>Receipt / proof (optional)</label>
        <div style={{ padding: 18, border: "2px dashed var(--border-strong)", borderRadius: "var(--radius-sm)", textAlign: "center", background: "var(--bg-muted)" }}>
          <div className="text-sm">Drop a photo, signed slip, or link</div>
          <div className="text-xs text-muted" style={{ marginTop: 4 }}>Helps officers approve faster</div>
        </div>
      </div>
      <div className="text-xs text-muted" style={{ marginTop: 8, padding: 10, background: "var(--bg-muted)", borderRadius: "var(--radius-sm)" }}>
        Hours will be reviewed by the service chair. Approved hours add to your term requirement and earn points.
      </div>
    </window.Modal>
  );
}

/* ═══════════════════════════ REPORTS ═══════════════════════════ */
function ReportsScreen({ ctx }) {
  const { roleKey } = ctx;
  const canView = window.hasCap(roleKey, "reports.view");
  if (!canView) return <window.EmptyState icon={window.I.lock} title="Officer access required" body="Reports are restricted to officers." />;

  const r = window.REPORT_HEALTH;
  const duesPct = Math.round((r.duesCollection.collected / r.duesCollection.target) * 100);
  const servicePct = Math.round((r.serviceHours.total / r.serviceHours.target) * 100);

  return (
    <>
      <div className="ledger-line">
        <div className="ledger-line__dot" />
        <h1 className="h-display" style={{ flex: 1 }}>Chapter health — {r.termLabel} <window.Proposed note="Proposed — aggregate analytics" /></h1>
        <button className="btn">Export PDF</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        <KPI label="ACTIVE MEMBERS" value={r.retention.active} sub={`${r.retention.active - r.retention.semAgo >= 0 ? "+" : ""}${r.retention.active - r.retention.semAgo} vs last term`} tone={r.retention.active >= r.retention.semAgo ? "success" : "warn"} />
        <KPI label="DUES COLLECTION" value={`${duesPct}%`} sub={`$${r.duesCollection.collected.toLocaleString()} / $${r.duesCollection.target.toLocaleString()}`} tone={duesPct >= 90 ? "success" : duesPct >= 75 ? "warn" : "danger"} />
        <KPI label="AVG ATTENDANCE" value={`${Math.round(r.attendance.rate * 100)}%`} sub={`mandatory ${Math.round(r.attendance.mandatoryRate * 100)}%`} />
        <KPI label="SERVICE HOURS" value={r.serviceHours.total} sub={`target ${r.serviceHours.target} · ${r.serviceHours.laggingCount} lagging`} tone={servicePct >= 70 ? "success" : "warn"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20, marginBottom: 20 }}>
        {/* Attendance trend */}
        <div className="card">
          <div className="card__head"><h3>Attendance trend — last 4 weeks</h3></div>
          <div style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 16, height: 140, paddingBottom: 24, borderBottom: "1px solid var(--divider)" }}>
              {r.attendance.last4.map((v, i) => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}>
                  <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--fg-muted)" }}>{Math.round(v * 100)}%</div>
                  <div style={{ width: "100%", maxWidth: 56, height: `${v * 100}%`, background: v >= 0.8 ? "var(--success)" : v >= 0.7 ? "var(--warn)" : "var(--danger)", borderRadius: "var(--radius-xs) var(--radius-xs) 0 0" }} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
              {["Wk 1","Wk 2","Wk 3","Wk 4"].map(l => (<div key={l} style={{ flex: 1, textAlign: "center", fontSize: 11, color: "var(--fg-muted)" }}>{l}</div>))}
            </div>
          </div>
        </div>

        {/* New member cohort */}
        <div className="card">
          <div className="card__head"><h3>New member cohort</h3></div>
          <div style={{ padding: 20 }}>
            <div className="eyebrow">WEEK {r.newMembers.weeksIn} OF {r.newMembers.weeksTotal}</div>
            <div style={{ fontSize: 30, fontWeight: 700, marginTop: 4 }}>{r.newMembers.onTrack}/{r.newMembers.cohort} <span style={{ fontSize: 14, fontWeight: 400, color: "var(--fg-muted)" }}>on track</span></div>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--success)" }} />
                <span>On track</span><span style={{ flex: 1 }} />
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{r.newMembers.onTrack}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: "var(--warn)" }} />
                <span>At risk</span><span style={{ flex: 1 }} />
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{r.newMembers.atRisk}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Retention history */}
      <div className="card">
        <div className="card__head"><h3>Retention history</h3></div>
        <div style={{ padding: 20, display: "flex", gap: 30 }}>
          {[
            { label: "1 year ago", val: r.retention.yearAgo },
            { label: "Last term",  val: r.retention.semAgo },
            { label: "Today",      val: r.retention.active },
          ].map((p, i, arr) => (
            <div key={p.label} style={{ flex: 1, borderRight: i < arr.length - 1 ? "1px solid var(--divider)" : "none", paddingRight: 20 }}>
              <div className="eyebrow">{p.label.toUpperCase()}</div>
              <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{p.val}</div>
              {i > 0 && (
                <div className="text-xs" style={{ color: p.val - arr[i-1].val >= 0 ? "var(--success-text)" : "var(--danger-text)", marginTop: 2 }}>
                  {p.val - arr[i-1].val >= 0 ? "↑" : "↓"} {Math.abs(p.val - arr[i-1].val)} from previous
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

Object.assign(window, { RushScreen, BillingScreen, HoursScreen, ReportsScreen });
