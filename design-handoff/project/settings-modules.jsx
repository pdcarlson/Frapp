/* Settings · Modules — what's on, what's off, with sub-features. */

const { useState: useStateM } = React;

function SettingsModules({ ctx }) {
  const { org, setOrg } = ctx;
  const [openModule, setOpenModule] = useStateM(null);

  const toggleModule = (key, on) => {
    setOrg(o => ({ ...o, modules: { ...o.modules, [key]: on }}));
  };
  const toggleSub = (sfKey, on) => {
    setOrg(o => ({ ...o, subFeatures: { ...o.subFeatures, [sfKey]: on }}));
  };

  const enabledCount = window.MODULE_CATALOG.filter(m => org.modules[m.key]).length;

  return (
    <>
      <window.SettingsHead
        title="Modules"
        sub={`${enabledCount} of ${window.MODULE_CATALOG.length} modules enabled. Disabled modules disappear from the sidebar and don't generate notifications.`}
      />

      <div className="modules-tbl">
        <div className="modules-tbl__head">
          <span>Module</span>
          <span>Sub-features</span>
          <span>Enabled</span>
        </div>
        {window.MODULE_CATALOG.map(m => {
          const on = !!org.modules[m.key];
          const subOnCount = m.subFeatures.filter(sf => org.subFeatures[sf.key]).length;
          const isOpen = openModule === m.key;
          return (
            <div key={m.key} className={`modules-row ${!on ? "modules-row--off" : ""}`}>
              <div className="modules-row__main">
                <button className="modules-row__expand" onClick={() => setOpenModule(isOpen ? null : m.key)} aria-label="Expand">
                  {React.cloneElement(isOpen ? window.I.chevronD : window.I.chevron, { style: { width: 14, height: 14 }})}
                </button>
                <div className="modules-row__icon">{window.I[m.icon] || window.I.folder}</div>
                <div className="modules-row__txt">
                  <div className="modules-row__name">{m.label}</div>
                  <div className="modules-row__desc">{m.description}</div>
                </div>
                <div className="modules-row__subcount">
                  {on ? <span>{subOnCount} / {m.subFeatures.length} on</span> : <span className="text-subtle">—</span>}
                </div>
                <div className="modules-row__switch">
                  <Switch checked={on} onChange={v => toggleModule(m.key, v)} />
                </div>
              </div>

              {isOpen && (
                <div className="modules-row__expand-body">
                  <div className="modules-row__category">{m.category === "core" ? "Core module" : m.category === "chapter" ? "Chapter operations" : "Admin"}</div>
                  <div className="sub-features">
                    {m.subFeatures.map(sf => {
                      const subOn = on && !!org.subFeatures[sf.key];
                      return (
                        <label key={sf.key} className={`sub-feature ${!on ? "sub-feature--disabled" : ""}`}>
                          <span>
                            <div className="sub-feature__name">{sf.label}</div>
                            <div className="sub-feature__key">{sf.key}</div>
                          </span>
                          <Switch
                            checked={subOn}
                            disabled={!on}
                            onChange={v => toggleSub(sf.key, v)}
                            size="sm"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* A tactile toggle. Not a generic AI-card-grid checkbox. */
function Switch({ checked, onChange, size, disabled }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`switch ${checked ? "switch--on" : ""} ${size === "sm" ? "switch--sm" : ""} ${disabled ? "switch--disabled" : ""}`}
      role="switch"
      aria-checked={checked}
    >
      <span className="switch__thumb" />
    </button>
  );
}

Object.assign(window, { SettingsModules, Switch });
