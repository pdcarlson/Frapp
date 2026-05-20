/* Settings · Custom fields — what's stored on each member beyond defaults. */

function SettingsFields({ ctx }) {
  const { org, setOrg } = ctx;
  const fields = org.customFields || [];

  const toggleRequired = (id) => {
    setOrg(o => ({
      ...o,
      customFields: o.customFields.map(f => f.id === id ? { ...f, required: !f.required } : f),
    }));
  };
  const setVisibility = (id, v) => {
    setOrg(o => ({
      ...o,
      customFields: o.customFields.map(f => f.id === id ? { ...f, visibleTo: v } : f),
    }));
  };
  const removeField = (id) => {
    if (!confirm("Remove this field? Existing member data for it will be archived but no longer visible.")) return;
    setOrg(o => ({ ...o, customFields: o.customFields.filter(f => f.id !== id) }));
  };

  return (
    <>
      <window.SettingsHead
        title="Custom fields"
        sub="Extra data captured on each member profile. Hidden by visibility scope — sensitive fields stay with exec."
      />

      <div className="set-card">
        <div className="set-card__head">
          <span>{fields.length} field{fields.length !== 1 ? "s" : ""}</span>
          <button className="btn btn--sm">{window.I.plus}<span>Add field</span></button>
        </div>
        <div className="set-card__body" style={{ padding: 0 }}>
          <table className="set-tbl">
            <thead>
              <tr>
                <th>Field</th>
                <th style={{ width: 110 }}>Type</th>
                <th style={{ width: 90 }}>Required</th>
                <th style={{ width: 160 }}>Visible to</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {fields.map(f => (
                <tr key={f.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <strong>{f.label}</strong>
                      {f.sensitive && <span className="chip chip--quiet" title="Sensitive — restricted by default">{window.I.lock && React.cloneElement(window.I.lock, { style: { width: 11, height: 11 }})} sensitive</span>}
                    </div>
                    {f.options && (
                      <div className="text-muted text-sm" style={{ marginTop: 4 }}>
                        {f.options.join(" · ")}
                      </div>
                    )}
                  </td>
                  <td className="text-muted" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{f.type}</td>
                  <td>
                    <window.Switch checked={f.required} onChange={() => toggleRequired(f.id)} size="sm" />
                  </td>
                  <td>
                    <select
                      className="input input--sm"
                      value={f.visibleTo}
                      onChange={e => setVisibility(f.id, e.target.value)}
                    >
                      <option value="self">Self only</option>
                      <option value="chapter">Whole chapter</option>
                      <option value="exec">Exec only</option>
                      <option value="president">President only</option>
                    </select>
                  </td>
                  <td>
                    <button className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => removeField(f.id)} title="Remove field">
                      {React.cloneElement(window.I.close, { style: { width: 14, height: 14 }})}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="set-card__foot">
          <span className="text-muted text-sm">
            Custom fields appear on the member profile form and are accessible via API at <code>/members/:id/custom</code>.
          </span>
        </div>
      </div>
    </>
  );
}

window.SettingsFields = SettingsFields;
