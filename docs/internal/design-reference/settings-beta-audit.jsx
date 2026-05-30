/* Settings · Beta program + Audit log. */

function SettingsBeta({ ctx }) {
  const { org, setOrg } = ctx;
  const setBeta = (k, v) => setOrg(o => ({ ...o, beta: { ...o.beta, [k]: v }}));

  return (
    <>
      <window.SettingsHead
        title="Beta program"
        sub={`You're on build 0.4.2. Frapp is in private beta — we ship weekly and may move things around.`}
      />

      <div className="set-card">
        <div className="set-card__head">
          <span>Build channel</span>
          <span className="set-card__chip set-card__chip--good">stable-beta</span>
        </div>
        <div className="set-card__body" style={{ padding: 0 }}>
          <window.SetRow label="Show beta indicator" hint="A visible marker so members understand they're using a pre-GA product.">
            <window.Switch checked={org.beta.enabled} onChange={v => setBeta("enabled", v)} />
          </window.SetRow>
          <window.SetRow label="Indicator style" hint="Where the BETA label appears.">
            <select className="input input--sm" value={org.beta.style} onChange={e => setBeta("style", e.target.value)} style={{ maxWidth: 220 }} disabled={!org.beta.enabled}>
              <option value="sidebar_pill">Sidebar pill (next to chapter name)</option>
              <option value="breadcrumb_pill">Breadcrumb pill</option>
              <option value="top_banner">Top banner (persistent)</option>
              <option value="corner_badge">Corner badge (with status pop-out)</option>
            </select>
          </window.SetRow>
        </div>
      </div>

      <div className="set-card">
        <div className="set-card__head">Known caveats this build</div>
        <div className="set-card__body" style={{ padding: 0 }}>
          {[
            { label: "Billing reconciliation",      severity: "watch",   note: "Bank webhooks delayed up to 6h. We're moving to push." },
            { label: "Rush funnel",                  severity: "watch",   note: "Bulk move between stages still 1-by-1. Multi-select shipping next week." },
            { label: "Reports → nationals export",   severity: "broken",  note: "Only CSV; nationals' XML format scheduled for 0.5." },
            { label: "Mobile attendance scan",       severity: "stable",  note: "Tested on iOS 17+ and Android 13+." },
          ].map((c, i) => (
            <div key={i} className="caveat-row">
              <div className={`caveat-row__sev caveat-row__sev--${c.severity}`}>{c.severity}</div>
              <div>
                <div className="caveat-row__label">{c.label}</div>
                <div className="caveat-row__note">{c.note}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="set-card">
        <div className="set-card__head">Feedback channels</div>
        <div className="set-card__body">
          <div className="feedback-grid">
            <div className="feedback-card">
              <div className="feedback-card__lbl">Slack</div>
              <div className="feedback-card__val">#frapp-beta</div>
              <div className="feedback-card__hint">Direct line to the team. Avg reply: ~2 hours.</div>
            </div>
            <div className="feedback-card">
              <div className="feedback-card__lbl">Email</div>
              <div className="feedback-card__val">beta@frapp.io</div>
              <div className="feedback-card__hint">Triaged daily.</div>
            </div>
            <div className="feedback-card">
              <div className="feedback-card__lbl">Office hours</div>
              <div className="feedback-card__val">Thurs 4–5pm ET</div>
              <div className="feedback-card__hint">Video; bring your gnarly workflow.</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function SettingsAudit({ ctx }) {
  const log = [
    { at: "2026-04-23T14:12:00", who: "Marcus Chen", action: "Enabled module", target: "Polls", scope: "settings.modules" },
    { at: "2026-04-23T11:02:00", who: "Priya Shah",  action: "Updated dues",   target: "grace period 5→7 days", scope: "settings.dues" },
    { at: "2026-04-22T20:45:00", who: "Marcus Chen", action: "Added field",    target: "T-shirt size", scope: "settings.fields" },
    { at: "2026-04-22T16:33:00", who: "Marcus Chen", action: "Disabled workflow", target: "wf_event_photo", scope: "settings.workflows" },
    { at: "2026-04-20T09:18:00", who: "Jordan Webb", action: "Invited member", target: "placeholder.user@local.test", scope: "members" },
    { at: "2026-04-18T17:00:00", who: "Marcus Chen", action: "Changed archetype", target: "IFC → IFC (no-op confirm)", scope: "settings.org" },
    { at: "2026-04-15T12:00:00", who: "System",      action: "Beta build deployed", target: "v0.4.2", scope: "platform" },
    { at: "2026-04-12T08:00:00", who: "System",      action: "Beta build deployed", target: "v0.4.1", scope: "platform" },
  ];

  return (
    <>
      <window.SettingsHead
        title="Audit log"
        sub="Every config change, member invite, and role assignment lands here. Retained 12 months in beta."
      />

      <div className="set-card">
        <div className="set-card__head">Recent changes</div>
        <div className="set-card__body" style={{ padding: 0 }}>
          <div className="audit-tbl">
            {log.map((row, i) => (
              <div key={i} className="audit-row">
                <div className="audit-row__time">
                  <div>{new Date(row.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
                  <div className="text-subtle text-sm">{new Date(row.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</div>
                </div>
                <div className="audit-row__main">
                  <div><strong>{row.who}</strong> <span className="text-muted">{row.action.toLowerCase()}</span> <strong>{row.target}</strong></div>
                  <div className="text-subtle text-sm" style={{ fontFamily: "var(--font-mono)", marginTop: 2 }}>{row.scope}</div>
                </div>
                <button className="btn btn--ghost btn--sm">View diff</button>
              </div>
            ))}
          </div>
        </div>
        <div className="set-card__foot">
          <span className="text-muted text-sm">Showing last 8 of ~340 entries. Filter / export coming in 0.5.</span>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { SettingsBeta, SettingsAudit });
