/* Points, Backwork, Onboarding screens. */

const { useState: useStateSS } = React;

/* ═══════════════════════════ POINTS ═══════════════════════════ */
function PointsScreen({ ctx }) {
  const { roleKey, currentUser } = ctx;
  const canAdjust = window.hasCap(roleKey, "points.adjust");
  const [adjustOpen, setAdjustOpen] = useStateSS(false);

  const byMember = {};
  window.POINTS_LEDGER.forEach(p => { byMember[p.userId] = (byMember[p.userId] || 0) + p.delta; });
  const leaderboard = window.MEMBERS_SEED
    .map(m => ({ ...m, total: (byMember[m.id] || 0) + m.pointBalance }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  return (
    <>
      <div className="ledger-line">
        <div className="ledger-line__dot" />
        <h1 className="h-display" style={{ flex: 1 }}>Points</h1>
        {canAdjust && <button className="btn btn--primary" onClick={() => setAdjustOpen(true)}>{React.cloneElement(I.plus, { style: { width: 14, height: 14 }})} Log adjustment</button>}
      </div>

      <div style={{ padding: 12, background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius)", marginBottom: 20, display: "flex", alignItems: "center", gap: 10 }}>
        {React.cloneElement(I.info, { style: { width: 16, height: 16, color: "var(--fg-muted)" }})}
        <div className="text-sm text-muted">Points ledger is <strong>append-only</strong>. Adjustments create a new entry with reason + officer signature — nothing is ever edited or deleted.</div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1.6fr", gap: 20 }}>
        <div className="card">
          <div className="card__head"><h3>Leaderboard</h3><div className="card__head-spacer" /><span className="chip">Spring 2026</span></div>
          <div>
            {leaderboard.map((m, i) => (
              <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: i < 9 ? "1px solid var(--divider)" : "none" }}>
                <div style={{ width: 22, fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: i < 3 ? "var(--primary)" : "var(--fg-muted)", textAlign: "center" }}>{i + 1}</div>
                <Avatar user={m} size="sm" />
                <div style={{ flex: 1, fontSize: 13, fontWeight: m.id === currentUser.id ? 600 : 400 }}>{m.name} {m.id === currentUser.id && <span className="chip chip--primary" style={{ marginLeft: 6, fontSize: 10 }}>You</span>}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{m.total}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card__head"><h3>Ledger — recent activity</h3><div className="card__head-spacer" /><input className="input" placeholder="Filter…" style={{ width: 160, fontSize: 12, padding: "5px 10px" }} /></div>
          <table className="table">
            <thead><tr><th>When</th><th>Member</th><th>Change</th><th>Reason</th><th>By</th></tr></thead>
            <tbody>
              {window.POINTS_LEDGER.map(p => {
                const m = window.memberOf(p.userId);
                const g = window.memberOf(p.grantedBy);
                return (
                  <tr key={p.id}>
                    <td className="text-xs text-muted">{window.formatDate(p.at)}</td>
                    <td><div style={{ display: "flex", alignItems: "center", gap: 6 }}><Avatar user={m} size="sm" /><span style={{ fontSize: 13 }}>{m.name}</span></div></td>
                    <td style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: p.delta > 0 ? "var(--success-text)" : "var(--danger-text)" }}>{p.delta > 0 ? "+" : ""}{p.delta}</td>
                    <td className="text-sm">{p.reason}</td>
                    <td className="text-xs text-muted">{g.name}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {adjustOpen && (
        <Modal open onClose={() => setAdjustOpen(false)} title="Log points adjustment" width={480}
          footer={<><button className="btn" onClick={() => setAdjustOpen(false)}>Cancel</button><button className="btn btn--primary">Append to ledger</button></>}>
          <div className="field"><label>Member</label><select className="select">{window.MEMBERS_SEED.map(m => <option key={m.id}>{m.name}</option>)}</select></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Direction</label><select className="select"><option>Grant (+)</option><option>Deduct (−)</option></select></div>
            <div className="field"><label>Amount</label><input className="input" type="number" defaultValue="5" /></div>
          </div>
          <div className="field"><label>Reason (required)</label><textarea className="textarea" rows="2" placeholder="Led chapter cleanup" /></div>
          <div className="text-xs text-muted" style={{ padding: 10, background: "var(--bg-muted)", borderRadius: "var(--radius-sm)" }}>
            Will be logged as: <strong>{currentUser.name}</strong> on {new Date().toDateString()}. Cannot be edited after submission.
          </div>
        </Modal>
      )}
    </>
  );
}

/* ═══════════════════════════ BACKWORK ═══════════════════════════ */
function BackworkScreen({ ctx }) {
  const { roleKey } = ctx;
  const [category, setCategory] = useStateSS("all");
  const [uploadOpen, setUploadOpen] = useStateSS(false);
  const [search, setSearch] = useStateSS("");
  const canUpload = window.hasCap(roleKey, "backwork.upload");

  const docs = window.BACKWORK_SEED.filter(d => {
    if (category !== "all" && d.category !== category) return false;
    if (search && !d.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <div className="ledger-line">
        <div className="ledger-line__dot" />
        <h1 className="h-display" style={{ flex: 1 }}>Backwork</h1>
        {canUpload && <button className="btn btn--primary" onClick={() => setUploadOpen(true)}>{React.cloneElement(I.upload, { style: { width: 14, height: 14 }})} Upload</button>}
      </div>

      <p className="text-sm text-muted" style={{ marginBottom: 20, maxWidth: 640 }}>
        Chapter archive — meeting minutes, budgets, policies, playbooks.
        Officer-only docs require role access; sensitive content auto-redacts names & amounts.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 20 }}>
        {/* Category sidebar */}
        <aside className="card" style={{ padding: 8, height: "fit-content" }}>
          {window.BACKWORK_CATEGORIES.map(c => (
            <div key={c.key} onClick={() => setCategory(c.key)} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
              borderRadius: "var(--radius-sm)", cursor: "pointer", fontSize: 13,
              background: category === c.key ? "var(--primary-soft)" : "transparent",
              color: category === c.key ? "var(--primary-hover)" : "var(--fg)",
              fontWeight: category === c.key ? 600 : 400,
            }}>
              <span style={{ flex: 1 }}>{c.label}</span>
              <span className="text-xs text-muted">{c.count}</span>
            </div>
          ))}
        </aside>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search documents…" style={{ flex: 1 }} />
            <button className="btn btn--sm">{I.filter} Filters</button>
          </div>

          {docs.length === 0 ? (
            <EmptyState icon={I.folder} title="No documents" body="Upload a PDF, sheet, or doc — we'll index it and make it searchable." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
              {docs.map(d => <DocCard key={d.id} doc={d} />)}
            </div>
          )}
        </div>
      </div>

      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} />}
    </>
  );
}

function DocCard({ doc }) {
  const uploader = window.memberOf(doc.uploadedBy);
  const typeColors = { pdf: "var(--danger)", doc: "var(--primary)", sheet: "var(--success)" };
  return (
    <div style={{
      padding: 14, background: "var(--bg-card)", border: "1px solid var(--border)",
      borderRadius: "var(--radius)", cursor: "pointer",
      transition: "border-color 120ms, box-shadow 120ms",
    }} onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.boxShadow = "var(--shadow-sm)"; }}
       onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 36, height: 46, borderRadius: 4, flexShrink: 0,
          background: `linear-gradient(135deg, ${typeColors[doc.type]} 0%, color-mix(in oklch, ${typeColors[doc.type]} 70%, black) 100%)`,
          display: "grid", placeItems: "center", color: "white", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em",
        }}>{doc.type}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>
            {doc.title}
            {doc.pinned && React.cloneElement(I.pin, { style: { width: 11, height: 11, marginLeft: 4, color: "var(--fg-muted)", verticalAlign: "middle" }})}
          </div>
          <div className="text-xs text-muted" style={{ marginTop: 2 }}>{doc.category} · {doc.term}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {doc.pages && <span className="chip" style={{ fontSize: 10 }}>{doc.pages} pages</span>}
        <span className="chip" style={{ fontSize: 10 }}>{doc.size}</span>
        {doc.hasRedactions && <span className="chip chip--warn" style={{ fontSize: 10 }}>{React.cloneElement(I.eyeOff, { style: { width: 9, height: 9 }})} Redactions</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingTop: 10, borderTop: "1px solid var(--divider)" }}>
        <Avatar user={uploader} size="sm" />
        <span className="text-xs text-muted" style={{ flex: 1 }}>{uploader.name} · {window.formatDate(doc.uploadedAt)}</span>
        <button className="icon-btn" style={{ width: 24, height: 24 }}>{React.cloneElement(I.download, { style: { width: 12, height: 12 }})}</button>
      </div>
    </div>
  );
}

function UploadModal({ onClose }) {
  const [step, setStep] = useStateSS(1);
  return (
    <Modal open onClose={onClose} title="Upload document" width={560}
      footer={step === 1 ? <><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn--primary" onClick={() => setStep(2)}>Next</button></>
        : <><button className="btn" onClick={() => setStep(1)}>Back</button><button className="btn btn--primary">Upload</button></>}>
      {step === 1 ? (
        <>
          <div style={{ padding: 32, border: "2px dashed var(--border-strong)", borderRadius: "var(--radius)", textAlign: "center", background: "var(--bg-muted)", marginBottom: 16 }}>
            {React.cloneElement(I.upload, { style: { width: 36, height: 36, color: "var(--fg-muted)", margin: "0 auto 10px", display: "block" }})}
            <div style={{ fontSize: 14, fontWeight: 600 }}>Drop files or click to browse</div>
            <div className="text-xs text-muted" style={{ marginTop: 4 }}>PDF, DOCX, XLSX up to 25MB</div>
          </div>
          <div className="field"><label>Category</label><select className="select"><option>Meetings</option><option>Finance</option><option>Rush</option><option>Policy</option><option>Onboarding</option><option>Events</option><option>Alumni</option></select></div>
          <div className="field"><label>Term</label><input className="input" defaultValue="Spring 2026" /></div>
        </>
      ) : (
        <>
          <h4 style={{ margin: "0 0 10px", fontSize: 14 }}>Auto-redaction <Proposed note="Proposed — uses on-device LLM to detect SSN, DOB, address, amounts" /></h4>
          <div className="text-sm text-muted" style={{ marginBottom: 14 }}>We scanned the document and found items that typically shouldn't be public. Review each before finalizing.</div>
          {[
            { kind: "SSN", count: 2, sample: "***-**-4721" },
            { kind: "Dollar amounts", count: 14, sample: "$2,400.00" },
            { kind: "Personal addresses", count: 5, sample: "12 College Ave" },
            { kind: "Phone numbers", count: 3, sample: "(650) 555-...." },
          ].map(r => (
            <div key={r.kind} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--divider)" }}>
              <input type="checkbox" defaultChecked={r.kind === "SSN"} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Redact {r.count} {r.kind.toLowerCase()}</div>
                <div className="text-xs text-muted" style={{ fontFamily: "var(--font-mono)" }}>e.g. {r.sample}</div>
              </div>
              <span className="chip" style={{ fontSize: 10 }}>{r.count} found</span>
            </div>
          ))}
          <div className="field" style={{ marginTop: 16 }}>
            <label>Access</label>
            <select className="select"><option>All members</option><option>Officers only</option><option>Exec board only</option></select>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ═══════════════════════════ ONBOARDING ═══════════════════════════ */
function OnboardingScreen({ ctx }) {
  const { roleKey } = ctx;
  const canManage = window.hasCap(roleKey, "onboarding.manage");
  const [createPathOpen, setCreatePathOpen] = useStateSS(false);

  if (!canManage) {
    // For new members — show their pathway
    if (roleKey === "newmember") {
      return <OnboardingMemberView />;
    }
    return <EmptyState icon={I.lock} title="Officer access required" body="Onboarding is managed by exec board and committee chairs." />;
  }

  const p = window.ONBOARDING_PATHWAY;
  const nmCount = p.newMembers.length;
  const doneCount = p.milestones.filter(m => m.status === "done").length;
  const percentOverall = Math.round((doneCount / p.totalWeeks) * 100);

  return (
    <>
      <div className="ledger-line">
        <div className="ledger-line__dot" />
        <h1 className="h-display" style={{ flex: 1 }}>Onboarding</h1>
        <button className="btn btn--primary" onClick={() => setCreatePathOpen(true)}>{React.cloneElement(I.plus, { style: { width: 14, height: 14 }})} New pathway</button>
      </div>

      {/* Active pathway header */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
            <div style={{ flex: 1 }}>
              <div className="eyebrow" style={{ marginBottom: 4 }}>Active pathway</div>
              <h2 className="h-title" style={{ fontSize: 20 }}>{p.name}</h2>
              <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                Week {p.currentWeek} of {p.totalWeeks} · {nmCount} new members · Initiation scheduled Dec 1
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}>{percentOverall}%</div>
              <div className="text-xs text-muted">cohort complete</div>
            </div>
          </div>

          {/* Timeline rail */}
          <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 0 }}>
            {p.milestones.map((m, i) => {
              const isDone = m.status === "done";
              const isCurrent = m.status === "current";
              return (
                <React.Fragment key={m.id}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                    background: isDone ? "var(--success)" : isCurrent ? "var(--primary)" : "var(--bg-muted)",
                    border: `2px solid ${isDone ? "var(--success)" : isCurrent ? "var(--primary)" : "var(--border-strong)"}`,
                    display: "grid", placeItems: "center",
                    color: (isDone || isCurrent) ? "white" : "var(--fg-muted)",
                    fontSize: 11, fontWeight: 700,
                  }}>
                    {isDone ? React.cloneElement(I.check, { style: { width: 13, height: 13 }}) : m.week}
                  </div>
                  {i < p.milestones.length - 1 && <div style={{ flex: 1, height: 2, background: i < p.milestones.findIndex(x => x.status === "current") ? "var(--success)" : "var(--border)" }} />}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Milestones list */}
        <div className="card">
          <div className="card__head"><h3>Milestones</h3></div>
          <div>
            {p.milestones.map((m, i) => {
              const isDone = m.status === "done";
              const isCurrent = m.status === "current";
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: i < p.milestones.length - 1 ? "1px solid var(--divider)" : "none" }}>
                  <div style={{ width: 50, flexShrink: 0 }}>
                    <div className="eyebrow" style={{ fontSize: 9 }}>WEEK {m.week}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>{m.title}</div>
                    <div className="text-xs text-muted">{m.kind === "event" ? "Event" : m.kind === "pairing" ? "Big/Little matching" : m.kind === "goal" ? `Target: ${m.target} hours` : m.kind === "quiz" ? "Quiz" : m.kind === "meeting" ? "1:1 meeting" : m.kind === "ritual" ? "Ritual ceremony" : "Form"}</div>
                  </div>
                  {isDone && <span className="chip chip--success">{React.cloneElement(I.check, { style: { width: 10, height: 10 }})} Done</span>}
                  {isCurrent && <span className="chip chip--primary">In progress</span>}
                  {m.status === "upcoming" && <span className="chip">Upcoming</span>}
                  <button className="icon-btn" style={{ width: 26, height: 26 }}>{React.cloneElement(I.more, { style: { width: 13, height: 13 }})}</button>
                </div>
              );
            })}
          </div>
        </div>

        {/* New member roster with per-member progress */}
        <div className="card">
          <div className="card__head"><h3>Cohort — {nmCount} new members</h3></div>
          <div>
            {p.newMembers.map((id, i) => {
              const m = window.memberOf(id);
              const pct = 40 + (id.charCodeAt(2) % 30);
              const attendance = 3 + (id.charCodeAt(3) % 3);
              return (
                <div key={id} style={{ padding: "14px 18px", borderBottom: i < nmCount - 1 ? "1px solid var(--divider)" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <Avatar user={m} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.name}</div>
                      <div className="text-xs text-muted">Big: Elena P. · Attended {attendance}/4 · {m.hoursThisTerm}h service</div>
                    </div>
                    <span className="chip" style={attendance < 3 ? { background: "var(--warn-soft)", color: "var(--warn-text)", borderColor: "var(--warn-border)" } : null}>{attendance < 3 ? "At risk" : "On track"}</span>
                  </div>
                  <div style={{ height: 4, background: "var(--bg-muted)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: pct >= 50 ? "var(--success)" : "var(--warn)" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {createPathOpen && <CreatePathwayWizard onClose={() => setCreatePathOpen(false)} />}
    </>
  );
}

function OnboardingMemberView() {
  // New member sees their own pathway (same as on Home but with more detail)
  const p = window.ONBOARDING_PATHWAY;
  return (
    <>
      <div className="ledger-line">
        <div className="ledger-line__dot" />
        <h1 className="h-display">Your onboarding pathway</h1>
      </div>
      <p className="text-sm text-muted" style={{ marginBottom: 20 }}>Your path to initiation. Every milestone you complete shows here — questions? DM your big or any officer.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {p.milestones.map(m => {
          const isDone = m.status === "done";
          const isCurrent = m.status === "current";
          return (
            <div key={m.id} className="card" style={{ padding: 16, display: "flex", alignItems: "center", gap: 16, borderColor: isCurrent ? "var(--primary)" : "var(--border)", background: isCurrent ? "var(--primary-soft)" : isDone ? "var(--success-soft)" : "var(--bg-card)" }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", flexShrink: 0, background: isDone ? "var(--success)" : isCurrent ? "var(--primary)" : "var(--bg-muted)", display: "grid", placeItems: "center", color: (isDone || isCurrent) ? "white" : "var(--fg-muted)", fontWeight: 700 }}>
                {isDone ? React.cloneElement(I.check, { style: { width: 16, height: 16 }}) : m.week}
              </div>
              <div style={{ flex: 1 }}>
                <div className="eyebrow" style={{ fontSize: 9 }}>WEEK {m.week}</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{m.title}</div>
              </div>
              {isCurrent && <button className="btn btn--primary btn--sm">Open</button>}
              {isDone && <span className="chip chip--success">Complete</span>}
              {m.status === "upcoming" && <span className="chip">Upcoming</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}

function CreatePathwayWizard({ onClose }) {
  const [step, setStep] = useStateSS(1);
  const steps = ["Basics", "Milestones", "Invite members"];
  return (
    <Modal open onClose={onClose} title="Create onboarding pathway" width={620}
      footer={
        <>
          <button className="btn" onClick={() => step > 1 ? setStep(step - 1) : onClose()}>{step > 1 ? "Back" : "Cancel"}</button>
          <div style={{ flex: 1 }} />
          {step < 3 ? <button className="btn btn--primary" onClick={() => setStep(step + 1)}>Next</button> : <button className="btn btn--primary">Publish pathway</button>}
        </>
      }>
      <div style={{ display: "flex", gap: 2, marginBottom: 20 }}>
        {steps.map((s, i) => (
          <div key={s} style={{ flex: 1 }}>
            <div style={{ height: 3, borderRadius: 2, background: step > i ? "var(--primary)" : "var(--bg-muted)" }} />
            <div className="text-xs text-muted" style={{ marginTop: 4, fontWeight: step === i + 1 ? 600 : 400, color: step === i + 1 ? "var(--fg)" : "var(--fg-muted)" }}>{s}</div>
          </div>
        ))}
      </div>

      {step === 1 && (
        <>
          <div className="field"><label>Pathway name</label><input className="input" placeholder="Delta 2026 — New Member Ed" /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field"><label>Start date</label><input className="input" type="date" /></div>
            <div className="field"><label>Duration (weeks)</label><input className="input" type="number" defaultValue="8" /></div>
          </div>
          <div className="field">
            <label>Template</label>
            <select className="select"><option>Copy from: Gamma 2024</option><option>Copy from: Beta 2023</option><option>Start blank</option></select>
          </div>
        </>
      )}
      {step === 2 && (
        <>
          <div className="text-sm text-muted" style={{ marginBottom: 12 }}>Milestones from your template — drag to reorder, click to edit.</div>
          {window.ONBOARDING_PATHWAY.milestones.map(m => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", marginBottom: 6 }}>
              {React.cloneElement(I.grip, { style: { width: 14, height: 14, color: "var(--fg-subtle)", cursor: "grab" }})}
              <span className="chip" style={{ fontSize: 10 }}>Wk {m.week}</span>
              <span style={{ flex: 1, fontSize: 13 }}>{m.title}</span>
              <span className="chip" style={{ fontSize: 10 }}>{m.kind}</span>
            </div>
          ))}
          <button className="btn btn--sm" style={{ marginTop: 8 }}>{React.cloneElement(I.plus, { style: { width: 12, height: 12 }})} Add milestone</button>
        </>
      )}
      {step === 3 && (
        <>
          <div className="text-sm text-muted" style={{ marginBottom: 12 }}>Invite new members. They'll receive their pathway on login.</div>
          <div className="field">
            <label>Invite emails (comma-separated or one per line)</label>
            <textarea className="textarea" rows="4" placeholder="aiden.k@stanford.edu, rio.nakamura@stanford.edu, …" />
          </div>
          <div className="field"><label>Auto-assign Big/Little</label>
            <select className="select"><option>Round-robin from volunteer list</option><option>Manual (assign later)</option></select>
          </div>
        </>
      )}
    </Modal>
  );
}

Object.assign(window, { PointsScreen, BackworkScreen, OnboardingScreen });
