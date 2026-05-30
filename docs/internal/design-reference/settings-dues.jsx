/* Settings · Dues — cadence, amounts, plans, late fees. */

function SettingsDues({ ctx }) {
  const { org, setOrg } = ctx;
  const d = org.dues;
  const set = (k, v) => setOrg(o => ({ ...o, dues: { ...o.dues, [k]: v }}));

  const billable =
    d.cadence === "annual" ? d.baseAmount :
    d.cadence === "semester" ? d.baseAmount * 2 :
    d.baseAmount * 12;

  return (
    <>
      <window.SettingsHead
        title="Dues structure"
        sub="How money flows. Defaulted to your archetype's typical pattern — most chapters change these in their first week."
      />

      <div className="set-card">
        <div className="set-card__head">Cadence</div>
        <div className="set-card__body">
          <div className="cadence-picker">
            {[
              { k: "semester", label: "Semester",  hint: "Two billings per year (Fall & Spring)" },
              { k: "annual",   label: "Annual",    hint: "One billing per year" },
              { k: "monthly",  label: "Monthly",   hint: "Twelve smaller billings" },
            ].map(opt => (
              <button
                key={opt.k}
                className={`cadence-opt ${d.cadence === opt.k ? "cadence-opt--active" : ""}`}
                onClick={() => set("cadence", opt.k)}
              >
                <div className="cadence-opt__label">{opt.label}</div>
                <div className="cadence-opt__hint">{opt.hint}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="set-card">
        <div className="set-card__head">Amounts</div>
        <div className="set-card__body">
          <div className="set-grid">
            <window.SetField label="Active member" hint={`Per ${d.cadence === "monthly" ? "month" : d.cadence === "annual" ? "year" : "semester"}`}>
              <div className="input-currency">
                <span>$</span>
                <input className="input" type="number" value={d.baseAmount} onChange={e => set("baseAmount", +e.target.value)} />
              </div>
            </window.SetField>
            <window.SetField label="New member" hint="Typically half-rate during onboarding term.">
              <div className="input-currency">
                <span>$</span>
                <input className="input" type="number" value={d.newMemberAmount} onChange={e => set("newMemberAmount", +e.target.value)} />
              </div>
            </window.SetField>
            <window.SetField label="Alumni" hint="0 if alumni don't pay chapter dues.">
              <div className="input-currency">
                <span>$</span>
                <input className="input" type="number" value={d.alumniAmount} onChange={e => set("alumniAmount", +e.target.value)} />
              </div>
            </window.SetField>
          </div>
          <div className="dues-summary">
            <span className="dues-summary__lbl">Approx. annual revenue per active</span>
            <span className="dues-summary__val">${billable.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="set-card">
        <div className="set-card__head">Plans &amp; grace</div>
        <div className="set-card__body" style={{ padding: 0 }}>
          <window.SetRow
            label="Allow installment plans"
            hint="Members can opt into multi-payment plans on overdue dues."
          >
            <window.Switch checked={d.installmentsAllowed} onChange={v => set("installmentsAllowed", v)} />
          </window.SetRow>
          {d.installmentsAllowed && (
            <window.SetRow
              label="Maximum installments"
              hint="Most chapters cap at 3-4."
            >
              <input className="input input--sm" type="number" value={d.installmentMax} onChange={e => set("installmentMax", +e.target.value)} style={{ width: 80 }} />
            </window.SetRow>
          )}
          <window.SetRow
            label="Grace period"
            hint="Days after due date before status flips to overdue."
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input className="input input--sm" type="number" value={d.gracePeriodDays} onChange={e => set("gracePeriodDays", +e.target.value)} style={{ width: 80 }} />
              <span className="text-muted text-sm">days</span>
            </div>
          </window.SetRow>
          <window.SetRow
            label="Late fees"
            hint="Charge an automatic fee on overdue invoices."
          >
            <window.Switch checked={d.lateFeeEnabled} onChange={v => set("lateFeeEnabled", v)} />
          </window.SetRow>
          {d.lateFeeEnabled && (
            <window.SetRow label="Late fee amount">
              <div className="input-currency" style={{ maxWidth: 110 }}>
                <span>$</span>
                <input className="input" type="number" value={d.lateFeeAmount} onChange={e => set("lateFeeAmount", +e.target.value)} />
              </div>
            </window.SetRow>
          )}
          <window.SetRow
            label="Scholarship pool"
            hint="Money set aside for need-based dues relief. Approved by treasurer + president."
          >
            <div className="input-currency" style={{ maxWidth: 130 }}>
              <span>$</span>
              <input className="input" type="number" value={d.scholarshipPool} onChange={e => set("scholarshipPool", +e.target.value)} />
            </div>
          </window.SetRow>
        </div>
      </div>
    </>
  );
}

window.SettingsDues = SettingsDues;
