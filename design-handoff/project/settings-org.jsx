/* Settings · Organization — identity, archetype, vocabulary. */

function SettingsOrg({ ctx }) {
  const { org, setOrg } = ctx;
  const b = org.branding;
  const setBrand = (k, v) => {
    setOrg(o => ({ ...o, branding: { ...o.branding, [k]: v }}));
  };
  const a = window.ORG_ARCHETYPES[org.archetype];

  const switchArchetype = (opt) => {
    if (opt.key === org.archetype) return;
    const ok = window.confirm(
      `Switch archetype to "${opt.label}"?\n\n` +
      `This resets module config, role pack, and vocabulary to that archetype's defaults.\n` +
      `Custom fields, dues, and branding are preserved.`
    );
    if (!ok) return;
    const next = window.makeOrgConfig(opt.key);
    setOrg(o => ({
      ...next,
      branding: o.branding,
      beta: o.beta,
      customFields: o.customFields,
      dues: o.dues,
    }));
  };

  return (
    <>
      <window.SettingsHead
        title="Organization"
        sub="Who you are. Shown on the sidebar header, invoices, and exports to nationals."
      />

      <div className="set-card">
        <div className="set-card__head">Identity</div>
        <div className="set-card__body">
          <div className="set-grid">
            <window.SetField label="Greek letters" hint="Unicode glyphs — used on the sidebar crest.">
              <input className="input" value={b.letters} onChange={e => setBrand("letters", e.target.value)} maxLength={4} style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }} />
            </window.SetField>
            <window.SetField label="Founded">
              <input className="input" type="number" value={b.foundedAt} onChange={e => setBrand("foundedAt", +e.target.value)} />
            </window.SetField>
            <window.SetField label="Chapter name" hint="Greek-letter name.">
              <input className="input" value={b.chapterName} onChange={e => setBrand("chapterName", e.target.value)} />
            </window.SetField>
            <window.SetField label="Chapter designation" hint="e.g. 'Pi Tau' — your chapter's name within nationals.">
              <input className="input" value={b.chapterDesignation} onChange={e => setBrand("chapterDesignation", e.target.value)} />
            </window.SetField>
            <window.SetField label="School (full)">
              <input className="input" value={b.school} onChange={e => setBrand("school", e.target.value)} />
            </window.SetField>
            <window.SetField label="School (short)" hint="Shown beside the chapter in the sidebar.">
              <input className="input" value={b.schoolShort} onChange={e => setBrand("schoolShort", e.target.value)} />
            </window.SetField>
          </div>
        </div>
      </div>

      <div className="set-card">
        <div className="set-card__head">
          <span>Archetype</span>
          <span className="set-card__chip">{a.short}</span>
        </div>
        <div className="set-card__body">
          <p className="text-muted text-sm" style={{ marginTop: 0 }}>
            {a.description} Sets defaults for modules, role vocabulary, and dues cadence.
          </p>
          <div className="archetype-grid">
            {Object.values(window.ORG_ARCHETYPES).map(opt => (
              <button
                key={opt.key}
                className={`archetype-card ${opt.key === org.archetype ? "archetype-card--active" : ""}`}
                onClick={() => switchArchetype(opt)}
              >
                <div className="archetype-card__short">{opt.short}</div>
                <div className="archetype-card__name">{opt.label}</div>
                <div className="archetype-card__desc">{opt.description}</div>
                {opt.key === org.archetype && <div className="archetype-card__active">Current</div>}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="set-card">
        <div className="set-card__head">Vocabulary</div>
        <div className="set-card__body">
          <p className="text-muted text-sm" style={{ marginTop: 0, marginBottom: 14 }}>
            The app uses these words throughout. Defaulted from your archetype — override any of them per-chapter.
          </p>
          <div className="set-grid">
            <window.SetField label="Recruitment process" hint="What you call the funnel: Rush, Recruitment, Intake, Induction.">
              <input className="input" value={org.vocabulary.recruitment} onChange={e => setOrg(o => ({ ...o, vocabulary: { ...o.vocabulary, recruitment: e.target.value }}))} />
            </window.SetField>
            <window.SetField label="New member term" hint="What you call a not-yet-initiated member: New Member, Pledge, Aspirant, Candidate.">
              <input className="input" value={org.vocabulary.pledge} onChange={e => setOrg(o => ({ ...o, vocabulary: { ...o.vocabulary, pledge: e.target.value }}))} />
            </window.SetField>
            <window.SetField label="Cohort label" hint="What you call a group of new members joining together: Pledge class, Line, Class, Cohort.">
              <input className="input" value={org.vocabulary.class} onChange={e => setOrg(o => ({ ...o, vocabulary: { ...o.vocabulary, class: e.target.value }}))} />
            </window.SetField>
          </div>
        </div>
      </div>
    </>
  );
}

window.SettingsOrg = SettingsOrg;
