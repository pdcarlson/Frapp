/* Settings · Workflows — opinionated org behaviors. */

function SettingsWorkflows({ ctx }) {
  const { org, setOrg } = ctx;

  const toggle = (key) => {
    setOrg(o => ({
      ...o,
      workflows: o.workflows.map(w => w.key === key ? { ...w, enabled: !w.enabled } : w),
    }));
  };
  const setThreshold = (key, val) => {
    setOrg(o => ({
      ...o,
      workflows: o.workflows.map(w => w.key === key ? { ...w, threshold: val } : w),
    }));
  };

  return (
    <>
      <window.SettingsHead
        title="Workflows"
        sub="Approvals, enforcement, and required steps. Each one is a small piece of opinion baked into how your chapter operates."
      />

      <div className="set-card">
        <div className="set-card__head">Active workflows</div>
        <div className="set-card__body" style={{ padding: 0 }}>
          {org.workflows.map((w, i) => (
            <div key={w.key} className={`wf-row ${!w.enabled ? "wf-row--off" : ""}`}>
              <div className="wf-row__num">{String(i + 1).padStart(2, "0")}</div>
              <div className="wf-row__main">
                <div className="wf-row__label">{w.label}</div>
                <div className="wf-row__key">{w.key}</div>
              </div>
              {w.threshold !== undefined && (
                <div className="wf-row__threshold">
                  <input
                    className="input input--sm"
                    type="number"
                    value={w.threshold}
                    onChange={e => setThreshold(w.key, +e.target.value)}
                    disabled={!w.enabled}
                    style={{ width: 80, textAlign: "right" }}
                  />
                  <span className="text-muted text-sm">{w.units}</span>
                </div>
              )}
              <div className="wf-row__switch">
                <window.Switch checked={w.enabled} onChange={() => toggle(w.key)} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="set-card">
        <div className="set-card__head">Custom workflow <span className="chip chip--quiet">Proposed</span></div>
        <div className="set-card__body">
          <p className="text-muted" style={{ marginTop: 0 }}>
            Build your own. When <em>X</em> happens, require <em>Y</em>, then notify <em>Z</em>. We're collecting use cases during beta — tell us
            what triggers and actions you need.
          </p>
          <button className="btn">{window.I.plus}<span>Request a workflow</span></button>
        </div>
      </div>
    </>
  );
}

window.SettingsWorkflows = SettingsWorkflows;
