/* Backwork — academic archive. Department → Course → Resource type → Term → File.
   Feels like a filesystem: breadcrumbs, folder grid, file list, search.
   Upload flow: drop → classify → AI-assisted redaction → attribution → submit.
*/

const { useState: useStateBW, useMemo: useMemoBW } = React;

/* ══════════════════════════ ROOT SCREEN ══════════════════════════ */
function BackworkScreen({ ctx }) {
  const { currentUser, roleKey } = ctx;

  // View state — { kind: "home" | "dept" | "course" | "myuploads", dept?, courseCode? }
  const [view, setView] = useStateBW({ kind: "home" });
  const [uploadOpen, setUploadOpen] = useStateBW(false);
  const [search, setSearch] = useStateBW("");
  const [selected, setSelected] = useStateBW(null); // selected resource for slideout

  const navTo = (v) => { setView(v); setSearch(""); };

  // Global search — searches across all resources
  const searchResults = useMemoBW(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    const courses = window.BW_COURSES.filter(c =>
      c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q) || c.professor.toLowerCase().includes(q)
    );
    const resources = window.BW_RESOURCES.filter(r =>
      r.title.toLowerCase().includes(q) || r.courseCode.toLowerCase().includes(q) || r.professor.toLowerCase().includes(q)
    );
    return { courses, resources };
  }, [search]);

  return (
    <>
      {/* Header */}
      <div className="ledger-line">
        <div className="ledger-line__dot" />
        <h1 className="h-display" style={{ flex: 1 }}>Backwork</h1>
        <button className="btn" onClick={() => navTo({ kind: "myuploads" })} style={view.kind === "myuploads" ? { borderColor: "var(--primary)", color: "var(--primary)" } : null}>My uploads</button>
        <button className="btn btn--primary" onClick={() => setUploadOpen(true)}>
          {React.cloneElement(window.I.upload, { style: { width: 14, height: 14 }})} Contribute
        </button>
      </div>

      {/* Breadcrumbs + search */}
      <BackworkCrumbs view={view} navTo={navTo} />

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <div style={{ position: "relative", flex: 1 }}>
          {React.cloneElement(window.I.search, { style: { width: 14, height: 14, position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--fg-muted)", pointerEvents: "none" }})}
          <input
            className="input"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search courses, exams, profs… e.g. 'CSCI 1200' or 'calc final'"
            style={{ width: "100%", paddingLeft: 34 }}
          />
        </div>
        {search && <button className="btn" onClick={() => setSearch("")}>Clear</button>}
      </div>

      {/* Content */}
      {searchResults ? (
        <BackworkSearch results={searchResults} onOpenCourse={code => navTo({ kind: "course", courseCode: code })} onOpenResource={setSelected} />
      ) : view.kind === "home" ? (
        <BackworkHome navTo={navTo} currentUser={currentUser} />
      ) : view.kind === "dept" ? (
        <BackworkDept deptKey={view.dept} navTo={navTo} />
      ) : view.kind === "course" ? (
        <BackworkCourse courseCode={view.courseCode} onOpenResource={setSelected} />
      ) : view.kind === "myuploads" ? (
        <BackworkMyUploads currentUser={currentUser} onOpenResource={setSelected} />
      ) : null}

      {uploadOpen && <BackworkUploadModal onClose={() => setUploadOpen(false)} currentUser={currentUser} />}
      {selected && <BackworkFileSlideout resource={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

/* ══════════════════════════ BREADCRUMBS ══════════════════════════ */
function BackworkCrumbs({ view, navTo }) {
  const crumbs = [{ label: "Backwork", onClick: () => navTo({ kind: "home" }) }];
  if (view.kind === "dept") {
    const d = window.BW_DEPARTMENTS.find(x => x.key === view.dept);
    crumbs.push({ label: `${d.key} · ${d.label}` });
  }
  if (view.kind === "course") {
    const c = window.BW_COURSES.find(x => x.code === view.courseCode);
    const d = window.BW_DEPARTMENTS.find(x => x.key === c.dept);
    crumbs.push({ label: `${d.key}`, onClick: () => navTo({ kind: "dept", dept: c.dept }) });
    crumbs.push({ label: `${c.code} — ${c.title}` });
  }
  if (view.kind === "myuploads") crumbs.push({ label: "My uploads" });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 14, fontSize: 12.5, flexWrap: "wrap" }}>
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && React.cloneElement(window.I.chevron, { style: { width: 12, height: 12, color: "var(--fg-subtle)" }})}
          {c.onClick ? (
            <button onClick={c.onClick} style={{ background: "none", border: "none", padding: 0, color: "var(--fg-muted)", cursor: "pointer", fontSize: 12.5, fontFamily: "inherit" }}>{c.label}</button>
          ) : (
            <span style={{ color: "var(--fg)", fontWeight: 500 }}>{c.label}</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ══════════════════════════ HOME ══════════════════════════ */
function BackworkHome({ navTo, currentUser }) {
  const totalFiles = window.BW_RESOURCES.length;
  const totalCourses = window.BW_COURSES.length;

  const popularCourses = [...window.BW_COURSES].sort((a, b) => b.popularity - a.popularity).slice(0, 6);

  return (
    <>
      {/* Hero row — bucket stats */}
      <div className="card" style={{ padding: 20, marginBottom: 20, background: "linear-gradient(135deg, var(--bg-card) 0%, var(--primary-soft) 240%)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 20 }}>
          <div style={{ flex: 1 }}>
            <div className="eyebrow">CHAPTER BACKWORK BUCKET</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 14, marginTop: 4 }}>
              <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em" }}>{totalFiles}</div>
              <div className="text-sm text-muted">files across {totalCourses} courses</div>
            </div>
            <p className="text-sm text-muted" style={{ marginTop: 8, maxWidth: 560 }}>
              Shared exams, homework, labs, and notes — uploaded by brothers past and present.
              All files are auto-redacted before upload; your name never ends up in the bucket.
            </p>
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            <Stat label="ALL TIME" value={window.BW_RESOURCES.reduce((s, r) => s + r.downloads, 0).toLocaleString()} sub="downloads" />
            <Stat label="THIS TERM" value={window.BW_RESOURCES.filter(r => r.term === "Fall 2024").length} sub="uploads" />
          </div>
        </div>
      </div>

      {/* Departments */}
      <SectionHeader title="Departments" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 28 }}>
        {window.BW_DEPARTMENTS.map(d => {
          const count = window.BW_COURSES.filter(c => c.dept === d.key).length;
          if (count === 0) return null;
          return (
            <button
              key={d.key}
              className="card"
              onClick={() => navTo({ kind: "dept", dept: d.key })}
              style={{ padding: 14, display: "flex", alignItems: "center", gap: 12, background: "var(--bg-card)", textAlign: "left", cursor: "pointer", border: "1px solid var(--border)", fontFamily: "inherit" }}
            >
              <div style={{ width: 36, height: 36, borderRadius: "var(--radius-sm)", background: d.color, color: "white", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 700, letterSpacing: "0.02em", flexShrink: 0 }}>{d.key}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg)" }}>{d.label}</div>
                <div className="text-xs text-muted" style={{ marginTop: 2 }}>{count} course{count === 1 ? "" : "s"}</div>
              </div>
              {React.cloneElement(window.I.chevron, { style: { width: 14, height: 14, color: "var(--fg-subtle)" }})}
            </button>
          );
        })}
      </div>

      {/* Popular courses */}
      <SectionHeader title="Most-grabbed courses" sub="Popularity across the whole chapter" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 28 }}>
        {popularCourses.map(c => (
          <CourseCard key={c.code} course={c} onClick={() => navTo({ kind: "course", courseCode: c.code })} />
        ))}
      </div>

      {/* Recent uploads + top contributors */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
        <div className="card">
          <div className="card__head"><h3>Recent uploads</h3></div>
          <div>
            {window.BW_RECENT.map((r, i) => (
              <div key={r.id} style={{ padding: "10px 16px", borderBottom: i < window.BW_RECENT.length - 1 ? "1px solid var(--divider)" : "none", display: "flex", alignItems: "center", gap: 10 }}>
                <FileTypeBadge type={r.fileType} kind={r.type} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.title}</div>
                  <div className="text-xs text-muted">{r.courseCode} · {r.term} · {r.professor}</div>
                </div>
                <div className="text-xs text-muted" style={{ fontFamily: "var(--font-mono)" }}>{window.formatDate(r.uploadedAt)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card__head"><h3>Top contributors</h3><div className="card__head-spacer" /><span className="chip">All-time</span></div>
          <div style={{ padding: 4 }}>
            {window.BW_TOP_CONTRIBUTORS.map((c, i) => {
              const m = window.memberOf(c.userId);
              return (
                <div key={c.userId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: i < window.BW_TOP_CONTRIBUTORS.length - 1 ? "1px solid var(--divider)" : "none" }}>
                  <div style={{ width: 20, textAlign: "center", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: i === 0 ? "var(--primary)" : "var(--fg-muted)" }}>{i + 1}</div>
                  <window.Avatar user={m} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</div>
                    <div className="text-xs text-muted">{m.pledgeClass}</div>
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600 }}>{c.count}</div>
                </div>
              );
            })}
            <div style={{ padding: "10px 12px", fontSize: 11.5, color: "var(--fg-muted)", background: "var(--bg-muted)", borderTop: "1px solid var(--divider)" }}>
              Anonymous uploads aren't counted here.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ══════════════════════════ DEPARTMENT VIEW ══════════════════════════ */
function BackworkDept({ deptKey, navTo }) {
  const d = window.BW_DEPARTMENTS.find(x => x.key === deptKey);
  const courses = window.BW_COURSES.filter(c => c.dept === deptKey);
  const [levelFilter, setLevelFilter] = useStateBW("all");

  const filtered = levelFilter === "all" ? courses : courses.filter(c => c.level === levelFilter);
  const levels = [...new Set(courses.map(c => c.level))].sort();

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <div style={{ width: 56, height: 56, borderRadius: "var(--radius)", background: d.color, color: "white", display: "grid", placeItems: "center", fontSize: 16, fontWeight: 700, letterSpacing: "0.02em", flexShrink: 0 }}>{d.key}</div>
        <div>
          <h2 className="h-title" style={{ fontSize: 22, margin: 0 }}>{d.label}</h2>
          <div className="text-sm text-muted" style={{ marginTop: 2 }}>{courses.length} course{courses.length === 1 ? "" : "s"} · {window.BW_RESOURCES.filter(r => courses.some(c => c.code === r.courseCode)).length} files</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        <button className={`btn btn--sm ${levelFilter === "all" ? "btn--primary" : ""}`} onClick={() => setLevelFilter("all")}>All levels</button>
        {levels.map(l => (
          <button key={l} className={`btn btn--sm ${levelFilter === l ? "btn--primary" : ""}`} onClick={() => setLevelFilter(l)}>{l}-level</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {filtered.map(c => (
          <CourseCard key={c.code} course={c} onClick={() => navTo({ kind: "course", courseCode: c.code })} />
        ))}
      </div>
      {filtered.length === 0 && <window.EmptyState title="No courses at this level" body="Try a different filter." />}
    </>
  );
}

/* ══════════════════════════ COURSE VIEW ══════════════════════════ */
function BackworkCourse({ courseCode, onOpenResource }) {
  const c = window.BW_COURSES.find(x => x.code === courseCode);
  const d = window.BW_DEPARTMENTS.find(x => x.key === c.dept);
  const resources = window.BW_RESOURCES.filter(r => r.courseCode === courseCode);

  const [activeType, setActiveType] = useStateBW("all");
  const [termFilter, setTermFilter] = useStateBW("all");

  const filtered = resources.filter(r => {
    if (activeType !== "all" && r.type !== activeType) return false;
    if (termFilter !== "all" && r.term !== termFilter) return false;
    return true;
  });

  // Count by type for tab badges
  const typeCounts = {};
  window.BW_RESOURCE_TYPES.forEach(t => typeCounts[t.key] = resources.filter(r => r.type === t.key).length);

  // Group filtered by term
  const byTerm = {};
  filtered.forEach(r => { (byTerm[r.term] = byTerm[r.term] || []).push(r); });
  const termOrder = window.BW_TERMS.filter(t => byTerm[t]);

  const availableTerms = [...new Set(resources.map(r => r.term))];

  return (
    <>
      {/* Course header */}
      <div className="card" style={{ padding: 20, marginBottom: 18, display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div style={{ width: 52, height: 52, borderRadius: "var(--radius)", background: d.color, color: "white", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 700, letterSpacing: "0.02em", flexShrink: 0 }}>{d.key}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-muted)", fontWeight: 600 }}>{c.code}</div>
          <h2 className="h-title" style={{ fontSize: 22, margin: "2px 0 0" }}>{c.title}</h2>
          <div className="text-sm text-muted" style={{ marginTop: 4 }}>
            Prof. {c.professor} · {resources.length} file{resources.length === 1 ? "" : "s"} · {c.contributors} contributors
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="eyebrow">POPULARITY</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{c.popularity}</div>
          <div className="text-xs text-muted">out of 100</div>
        </div>
      </div>

      {/* Resource type tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 16, overflow: "auto" }}>
        <TypeTab active={activeType === "all"} onClick={() => setActiveType("all")} label="All" count={resources.length} />
        {window.BW_RESOURCE_TYPES.map(t => (
          <TypeTab key={t.key} active={activeType === t.key} onClick={() => setActiveType(t.key)} label={t.label} count={typeCounts[t.key]} />
        ))}
      </div>

      {/* Term filter */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span className="text-xs text-muted" style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Term</span>
        <button className={`chip ${termFilter === "all" ? "chip--primary" : ""}`} onClick={() => setTermFilter("all")} style={{ cursor: "pointer", border: "none" }}>All</button>
        {availableTerms.map(t => (
          <button key={t} className={`chip ${termFilter === t ? "chip--primary" : ""}`} onClick={() => setTermFilter(t)} style={{ cursor: "pointer", border: "none" }}>{t}</button>
        ))}
      </div>

      {/* Files grouped by term */}
      {filtered.length === 0 ? (
        <window.EmptyState icon={window.I.folder} title="Nothing uploaded yet" body="Be the first to contribute — it counts toward your chapter engagement." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {termOrder.map(term => (
            <div key={term} className="card">
              <div className="card__head">
                <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {term}
                  <span className="chip" style={{ fontSize: 10 }}>{byTerm[term].length}</span>
                </h3>
              </div>
              <div>
                {byTerm[term].map((r, i) => (
                  <ResourceRow key={r.id} resource={r} onClick={() => onOpenResource(r)} isLast={i === byTerm[term].length - 1} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ══════════════════════════ MY UPLOADS ══════════════════════════ */
function BackworkMyUploads({ currentUser, onOpenResource }) {
  const mine = window.BW_RESOURCES.filter(r => r.uploaderId === currentUser.id);
  const totalDl = mine.reduce((s, r) => s + r.downloads, 0);
  const avgRating = mine.filter(r => r.rating).reduce((s, r) => s + r.rating, 0) / (mine.filter(r => r.rating).length || 1);

  if (mine.length === 0) {
    return <window.EmptyState icon={window.I.upload} title="No uploads yet" body="Contribute exams, notes, or homework — it counts toward your chapter engagement." />;
  }

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
        <Stat label="YOUR UPLOADS" value={mine.length} sub="files contributed" big />
        <Stat label="TOTAL DOWNLOADS" value={totalDl.toLocaleString()} sub={`across ${mine.length} files`} big />
        <Stat label="AVG RATING" value={avgRating.toFixed(1)} sub={`${mine.filter(r => r.rating).length} rated`} big />
      </div>

      <div className="card">
        <div className="card__head"><h3>Your files</h3></div>
        <div>
          {mine.map((r, i) => (
            <ResourceRow key={r.id} resource={r} onClick={() => onOpenResource(r)} isLast={i === mine.length - 1} showCourse />
          ))}
        </div>
      </div>
    </>
  );
}

/* ══════════════════════════ SEARCH RESULTS ══════════════════════════ */
function BackworkSearch({ results, onOpenCourse, onOpenResource }) {
  return (
    <>
      {results.courses.length > 0 && (
        <>
          <SectionHeader title={`Courses (${results.courses.length})`} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
            {results.courses.map(c => <CourseCard key={c.code} course={c} onClick={() => onOpenCourse(c.code)} />)}
          </div>
        </>
      )}
      {results.resources.length > 0 && (
        <>
          <SectionHeader title={`Files (${results.resources.length})`} />
          <div className="card">
            {results.resources.slice(0, 20).map((r, i, a) => (
              <ResourceRow key={r.id} resource={r} onClick={() => onOpenResource(r)} isLast={i === a.length - 1} showCourse />
            ))}
          </div>
        </>
      )}
      {results.courses.length === 0 && results.resources.length === 0 && (
        <window.EmptyState icon={window.I.search} title="No matches" body="Try a course code like 'CSCI-1200', a prof name, or keywords like 'final' or 'calc'." />
      )}
    </>
  );
}

/* ══════════════════════════ REUSABLE PIECES ══════════════════════════ */
function SectionHeader({ title, sub }) {
  return (
    <div style={{ marginBottom: 10, display: "flex", alignItems: "baseline", gap: 10 }}>
      <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--fg)" }}>{title}</h3>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </div>
  );
}

function Stat({ label, value, sub, big }) {
  return (
    <div className="card" style={{ padding: big ? 16 : 0, background: big ? "var(--bg-card)" : "transparent", border: big ? null : "none", boxShadow: big ? null : "none" }}>
      <div className="eyebrow">{label}</div>
      <div style={{ fontSize: big ? 26 : 22, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 4 }}>{value}</div>
      <div className="text-xs text-muted" style={{ marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function CourseCard({ course, onClick }) {
  const d = window.BW_DEPARTMENTS.find(x => x.key === course.dept);
  return (
    <button
      onClick={onClick}
      className="card"
      style={{ padding: 16, textAlign: "left", cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 10, background: "var(--bg-card)", border: "1px solid var(--border)" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-strong)"; e.currentTarget.style.boxShadow = "var(--shadow-sm)"; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.boxShadow = "none"; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: "var(--radius-sm)", background: d.color, color: "white", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 700, letterSpacing: "0.02em", flexShrink: 0 }}>{d.key}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)", fontWeight: 600 }}>{course.code}</div>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{course.title}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 11.5, color: "var(--fg-muted)" }}>
        <span>{course.resourceCount} files</span>
        <span>·</span>
        <span>{course.contributors} contributors</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: course.popularity >= 85 ? "var(--success-text)" : "var(--fg-muted)" }}>{course.popularity}</span>
      </div>
    </button>
  );
}

function TypeTab({ active, onClick, label, count }) {
  return (
    <button onClick={onClick} style={{
      padding: "10px 14px", background: "none", border: "none",
      borderBottom: `2px solid ${active ? "var(--primary)" : "transparent"}`,
      color: active ? "var(--fg)" : "var(--fg-muted)",
      fontWeight: active ? 600 : 400, fontSize: 13, cursor: "pointer", marginBottom: -1,
      display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
    }}>
      {label}
      {count > 0 && <span className="chip" style={{ fontSize: 10, padding: "1px 6px" }}>{count}</span>}
    </button>
  );
}

function FileTypeBadge({ type, kind, size = "md" }) {
  const colors = { pdf: "var(--danger)", doc: "var(--primary)", sheet: "var(--success)" };
  const typeColors = { exam: "var(--danger)", quiz: "var(--warn)", hw: "var(--primary)", lab: "var(--hue-teal)", notes: "var(--hue-violet)", other: "var(--fg-muted)" };
  const color = typeColors[kind] || colors[type] || "var(--fg-muted)";
  const label = { exam: "EXAM", quiz: "QUIZ", hw: "HW", lab: "LAB", notes: "NOTE", other: "DOC" }[kind] || "DOC";
  const dims = size === "sm" ? { w: 28, h: 36, fs: 8 } : { w: 36, h: 46, fs: 9 };
  return (
    <div style={{
      width: dims.w, height: dims.h, borderRadius: 4, flexShrink: 0,
      background: `linear-gradient(135deg, ${color} 0%, color-mix(in oklch, ${color} 70%, black) 100%)`,
      display: "grid", placeItems: "center", color: "white", fontSize: dims.fs, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
    }}>{label}</div>
  );
}

function ResourceRow({ resource: r, onClick, isLast, showCourse }) {
  const uploader = window.memberOf(r.uploaderId);
  const attribLabel = r.attribution === "anonymous" ? "Anonymous" : r.attribution === "me" ? uploader.name : `${uploader.pledgeClass}`;
  return (
    <div
      onClick={onClick}
      style={{ padding: "12px 18px", borderBottom: isLast ? "none" : "1px solid var(--divider)", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", transition: "background 120ms" }}
      onMouseEnter={e => { e.currentTarget.style.background = "var(--bg-muted)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
    >
      <FileTypeBadge type={r.fileType} kind={r.type} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 13.5, fontWeight: 500 }}>{r.title}</span>
          {r.hasAnswerKey && <span className="chip chip--success" style={{ fontSize: 9 }}>Answer key</span>}
          {r.solution && <span className="chip chip--primary" style={{ fontSize: 9 }}>Solutions</span>}
          {r.redacted && <span title="Name redacted before upload" style={{ color: "var(--fg-subtle)" }}>{React.cloneElement(window.I.eyeOff, { style: { width: 12, height: 12 }})}</span>}
        </div>
        <div className="text-xs text-muted">
          {showCourse && <><strong style={{ fontFamily: "var(--font-mono)", color: "var(--fg-muted)" }}>{r.courseCode}</strong> · </>}
          Prof. {r.professor} · {r.term} · {r.pages} pages · {r.size}
        </div>
      </div>
      {r.rating && (
        <div style={{ textAlign: "right", fontSize: 11.5 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--fg)" }}>★ {r.rating}</div>
          <div className="text-xs text-muted">{r.ratingCount}</div>
        </div>
      )}
      <div style={{ textAlign: "right", fontSize: 11.5, minWidth: 70 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--fg)" }}>{r.downloads}</div>
        <div className="text-xs text-muted">downloads</div>
      </div>
      <div style={{ textAlign: "right", fontSize: 11.5, minWidth: 110 }}>
        <div style={{ fontSize: 12, color: "var(--fg)" }}>{attribLabel}</div>
        <div className="text-xs text-muted">{window.formatDate(r.uploadedAt)}</div>
      </div>
      <button className="btn btn--sm" onClick={e => { e.stopPropagation(); }} style={{ flexShrink: 0 }}>
        {React.cloneElement(window.I.download, { style: { width: 12, height: 12 }})}
      </button>
    </div>
  );
}

/* ══════════════════════════ FILE SLIDEOUT ══════════════════════════ */
function BackworkFileSlideout({ resource: r, onClose }) {
  const uploader = window.memberOf(r.uploaderId);
  const course = window.BW_COURSES.find(c => c.code === r.courseCode);
  const attribLabel = r.attribution === "anonymous" ? "Anonymous contributor" : r.attribution === "me" ? uploader.name : `${uploader.pledgeClass} pledge class`;

  return (
    <window.Slideout open onClose={onClose} title={r.title}
      footer={<>
        <button className="btn">Flag issue</button>
        <div style={{ flex: 1 }} />
        <button className="btn">Preview</button>
        <button className="btn btn--primary">{React.cloneElement(window.I.download, { style: { width: 14, height: 14 }})} Download</button>
      </>}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <FileTypeBadge type={r.fileType} kind={r.type} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{r.title}</div>
          <div className="text-sm text-muted">{r.courseCode} — {course?.title}</div>
          <div className="text-xs text-muted" style={{ marginTop: 2 }}>Prof. {r.professor} · {r.term}</div>
        </div>
      </div>

      {/* Tags */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
        <span className="chip">{r.pages} pages</span>
        <span className="chip">{r.size}</span>
        <span className="chip" style={{ textTransform: "uppercase" }}>{r.fileType}</span>
        {r.hasAnswerKey && <span className="chip chip--success">Includes answer key</span>}
        {r.solution && <span className="chip chip--primary">Has solutions</span>}
        {r.redacted && <span className="chip" style={{ fontSize: 10 }}>{React.cloneElement(window.I.eyeOff, { style: { width: 10, height: 10 }})} Name redacted</span>}
      </div>

      {/* Preview placeholder */}
      <div style={{ aspectRatio: "3 / 4", background: "var(--bg-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius)", display: "grid", placeItems: "center", marginBottom: 20, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 20, border: "1px dashed var(--border-strong)", borderRadius: 4, padding: 16, display: "flex", flexDirection: "column", gap: 8, background: "var(--bg-card)" }}>
          <div style={{ height: 10, width: "60%", background: "var(--bg-muted)", borderRadius: 2 }} />
          <div style={{ height: 6, width: "100%", background: "var(--bg-muted)", borderRadius: 2 }} />
          <div style={{ height: 6, width: "90%", background: "var(--bg-muted)", borderRadius: 2 }} />
          <div style={{ height: 6, width: "95%", background: "var(--bg-muted)", borderRadius: 2 }} />
          <div style={{ height: 6, width: "40%", background: "var(--bg-muted)", borderRadius: 2 }} />
          {/* Redacted box */}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <div style={{ height: 6, width: 40, background: "var(--bg-muted)", borderRadius: 2 }} />
            <div style={{ height: 8, width: 80, background: "var(--fg)", borderRadius: 1 }} title="Redacted" />
          </div>
          <div style={{ height: 6, width: "70%", background: "var(--bg-muted)", borderRadius: 2, marginTop: 12 }} />
          <div style={{ height: 6, width: "85%", background: "var(--bg-muted)", borderRadius: 2 }} />
          <div style={{ flex: 1 }} />
          <div className="text-xs text-muted" style={{ textAlign: "center" }}>Preview — page 1 of {r.pages}</div>
        </div>
      </div>

      {/* Uploader */}
      <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Uploaded by</h4>
      <div style={{ padding: 12, background: "var(--bg-muted)", borderRadius: "var(--radius-sm)", display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        {r.attribution === "anonymous" ? (
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--bg-card)", border: "1px dashed var(--border-strong)", display: "grid", placeItems: "center", color: "var(--fg-muted)" }}>
            {React.cloneElement(window.I.eyeOff, { style: { width: 16, height: 16 }})}
          </div>
        ) : (
          <window.Avatar user={uploader} />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{attribLabel}</div>
          <div className="text-xs text-muted">{window.formatDate(r.uploadedAt)}</div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        <div style={{ padding: 12, background: "var(--bg-muted)", borderRadius: "var(--radius-sm)" }}>
          <div className="eyebrow">DOWNLOADS</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{r.downloads}</div>
        </div>
        <div style={{ padding: 12, background: "var(--bg-muted)", borderRadius: "var(--radius-sm)" }}>
          <div className="eyebrow">RATING</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{r.rating ? `★ ${r.rating}` : "—"}</div>
          {r.ratingCount > 0 && <div className="text-xs text-muted">{r.ratingCount} ratings</div>}
        </div>
      </div>
    </window.Slideout>
  );
}

/* ══════════════════════════ UPLOAD MODAL ══════════════════════════ */
function BackworkUploadModal({ onClose, currentUser }) {
  const [step, setStep] = useStateBW(1);
  const [form, setForm] = useStateBW({
    file: null,
    dept: "CSCI",
    courseCode: "CSCI-1200",
    professor: "Cutler",
    type: "exam",
    term: "Fall 2024",
    title: "",
    attribution: "pledge_class",
    redactions: null,
  });

  const deptCourses = window.BW_COURSES.filter(c => c.dept === form.dept);

  const next = () => setStep(step + 1);
  const back = () => setStep(Math.max(1, step - 1));

  const canProceed =
    step === 1 ? form.file :
    step === 2 ? form.courseCode && form.type && form.term && form.title :
    step === 3 ? form.redactions :
    step === 4 ? true : false;

  const steps = ["Upload file", "Classify", "Redact PII", "Attribution", "Review"];

  return (
    <window.Modal open onClose={onClose} title="Contribute to backwork" width={640}
      footer={
        <>
          <button className="btn" onClick={step > 1 ? back : onClose}>{step > 1 ? "Back" : "Cancel"}</button>
          <div style={{ flex: 1 }} />
          {step < 5 ? (
            <button className="btn btn--primary" disabled={!canProceed} onClick={next}>{step === 1 ? "Next →" : step === 3 ? "Apply redactions →" : "Next →"}</button>
          ) : (
            <button className="btn btn--primary">{React.cloneElement(window.I.upload, { style: { width: 14, height: 14 }})} Upload to bucket</button>
          )}
        </>
      }>
      {/* Step indicator */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
        {steps.map((s, i) => (
          <div key={s} style={{ flex: 1 }}>
            <div style={{ height: 3, borderRadius: 2, background: step > i ? "var(--primary)" : step === i + 1 ? "var(--primary)" : "var(--bg-muted)" }} />
            <div style={{ marginTop: 6, fontSize: 11, fontWeight: step === i + 1 ? 600 : 400, color: step === i + 1 ? "var(--fg)" : "var(--fg-muted)" }}>
              {i + 1}. {s}
            </div>
          </div>
        ))}
      </div>

      {/* STEP 1: File drop */}
      {step === 1 && (
        <>
          <div
            style={{
              padding: 36, border: "2px dashed var(--border-strong)", borderRadius: "var(--radius)", textAlign: "center",
              background: form.file ? "var(--success-soft)" : "var(--bg-muted)", marginBottom: 14, cursor: "pointer",
              transition: "background 120ms",
            }}
            onClick={() => setForm({ ...form, file: { name: "Cutler_Final_Fall2024.pdf", size: "2.4 MB", pages: 14 }})}
          >
            {form.file ? (
              <>
                {React.cloneElement(window.I.check, { style: { width: 32, height: 32, color: "var(--success-text)", margin: "0 auto 8px", display: "block" }})}
                <div style={{ fontSize: 14, fontWeight: 600 }}>{form.file.name}</div>
                <div className="text-xs text-muted" style={{ marginTop: 4 }}>{form.file.size} · {form.file.pages} pages · PDF</div>
                <button className="btn btn--sm" style={{ marginTop: 10 }} onClick={(e) => { e.stopPropagation(); setForm({ ...form, file: null }); }}>Replace</button>
              </>
            ) : (
              <>
                {React.cloneElement(window.I.upload, { style: { width: 36, height: 36, color: "var(--fg-muted)", margin: "0 auto 10px", display: "block" }})}
                <div style={{ fontSize: 14, fontWeight: 600 }}>Drop a file or click to browse</div>
                <div className="text-xs text-muted" style={{ marginTop: 4 }}>PDF, DOCX, images — up to 25MB</div>
                <div className="text-xs text-muted" style={{ marginTop: 8, padding: "8px 12px", background: "var(--bg-card)", borderRadius: "var(--radius-sm)", display: "inline-block" }}>
                  Scanned photos of handwritten work are fine — we'll OCR.
                </div>
              </>
            )}
          </div>
          <div className="text-xs text-muted" style={{ padding: 12, background: "var(--primary-soft)", borderRadius: "var(--radius-sm)", display: "flex", alignItems: "flex-start", gap: 8 }}>
            {React.cloneElement(window.I.info, { style: { width: 14, height: 14, marginTop: 1, flexShrink: 0, color: "var(--primary)" }})}
            <div style={{ color: "var(--fg)" }}>
              <strong>Your work, your choice.</strong> In the next steps you'll classify the file, scrub your name from it, and pick how you're credited. Nothing goes to the bucket until you confirm.
            </div>
          </div>
        </>
      )}

      {/* STEP 2: Classify */}
      {step === 2 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Department</label>
              <select className="select" value={form.dept} onChange={e => {
                const firstCourse = window.BW_COURSES.find(c => c.dept === e.target.value);
                setForm({ ...form, dept: e.target.value, courseCode: firstCourse?.code || "", professor: firstCourse?.professor || "" });
              }}>
                {window.BW_DEPARTMENTS.map(d => <option key={d.key} value={d.key}>{d.key} — {d.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Course</label>
              <select className="select" value={form.courseCode} onChange={e => {
                const c = window.BW_COURSES.find(x => x.code === e.target.value);
                setForm({ ...form, courseCode: e.target.value, professor: c?.professor || "" });
              }}>
                {deptCourses.map(c => <option key={c.code} value={c.code}>{c.code} — {c.title}</option>)}
              </select>
            </div>
          </div>

          <div className="field">
            <label>Resource type</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginTop: 4 }}>
              {window.BW_RESOURCE_TYPES.map(t => (
                <button key={t.key} onClick={() => setForm({ ...form, type: t.key })} style={{
                  padding: 10, background: form.type === t.key ? "var(--primary-soft)" : "var(--bg-card)",
                  border: `1px solid ${form.type === t.key ? "var(--primary)" : "var(--border)"}`,
                  borderRadius: "var(--radius-sm)", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
                  color: form.type === t.key ? "var(--primary-hover)" : "var(--fg)",
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</div>
                  <div className="text-xs text-muted" style={{ marginTop: 2 }}>{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div className="field">
              <label>Term</label>
              <select className="select" value={form.term} onChange={e => setForm({ ...form, term: e.target.value })}>
                {window.BW_TERMS.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Professor</label>
              <input className="input" value={form.professor} onChange={e => setForm({ ...form, professor: e.target.value })} />
            </div>
          </div>

          <div className="field">
            <label>Title</label>
            <input className="input" placeholder="e.g. Final Exam, HW 4, Ch. 7 Study Guide" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            <div className="text-xs text-muted" style={{ marginTop: 4 }}>Be descriptive — "Midterm 1" beats "midterm". Future brothers will thank you.</div>
          </div>
        </>
      )}

      {/* STEP 3: Redact */}
      {step === 3 && (
        <RedactStep form={form} setForm={setForm} currentUser={currentUser} />
      )}

      {/* STEP 4: Attribution */}
      {step === 4 && (
        <>
          <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>How do you want to be credited?</h4>
          <p className="text-sm text-muted" style={{ marginBottom: 14 }}>
            Your name was redacted <em>inside</em> the file — this is about how the <em>upload</em> is attributed in the bucket.
          </p>
          {[
            { key: "me",            title: `${currentUser.name}`, sub: "Get credit on the leaderboard. Brothers can see you uploaded it.", icon: "✓" },
            { key: "pledge_class",  title: `${currentUser.pledgeClass} pledge class`, sub: "Credit your pledge class without singling you out.", icon: "◎" },
            { key: "anonymous",     title: "Anonymous", sub: "Nobody — not even officers — can see who uploaded it. Not counted on leaderboard.", icon: "?" },
          ].map(opt => {
            const active = form.attribution === opt.key;
            return (
              <button key={opt.key} onClick={() => setForm({ ...form, attribution: opt.key })} style={{
                width: "100%", padding: 14, marginBottom: 8, textAlign: "left",
                background: active ? "var(--primary-soft)" : "var(--bg-card)",
                border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
                borderRadius: "var(--radius-sm)", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, fontFamily: "inherit",
              }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: active ? "var(--primary)" : "var(--bg-muted)", color: active ? "white" : "var(--fg-muted)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13, flexShrink: 0 }}>{opt.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)" }}>{opt.title}</div>
                  <div className="text-xs text-muted" style={{ marginTop: 2 }}>{opt.sub}</div>
                </div>
                {active && React.cloneElement(window.I.check, { style: { width: 16, height: 16, color: "var(--primary)" }})}
              </button>
            );
          })}
        </>
      )}

      {/* STEP 5: Review */}
      {step === 5 && (
        <>
          <h4 style={{ margin: "0 0 12px", fontSize: 14 }}>Ready to upload</h4>
          <div style={{ padding: 16, background: "var(--bg-muted)", borderRadius: "var(--radius-sm)", marginBottom: 14 }}>
            <ReviewRow label="File" value={form.file?.name} />
            <ReviewRow label="Course" value={`${form.courseCode} — ${window.BW_COURSES.find(c => c.code === form.courseCode)?.title || ""}`} />
            <ReviewRow label="Type" value={window.BW_RESOURCE_TYPES.find(t => t.key === form.type)?.label} />
            <ReviewRow label="Term" value={`${form.term} · Prof. ${form.professor}`} />
            <ReviewRow label="Title" value={form.title} />
            <ReviewRow label="Redactions" value={`${form.redactions?.count || 0} items redacted`} />
            <ReviewRow label="Attribution" value={{ me: currentUser.name, pledge_class: `${currentUser.pledgeClass} pledge class`, anonymous: "Anonymous" }[form.attribution]} />
          </div>
          <div className="text-xs" style={{ padding: 12, background: "var(--success-soft)", borderRadius: "var(--radius-sm)", color: "var(--success-text)", display: "flex", gap: 8 }}>
            {React.cloneElement(window.I.check, { style: { width: 14, height: 14, flexShrink: 0, marginTop: 1 }})}
            <div>Redactions are applied before the file leaves your device. The original is never uploaded.</div>
          </div>
        </>
      )}
    </window.Modal>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "6px 0", fontSize: 13 }}>
      <div style={{ width: 110, color: "var(--fg-muted)", fontSize: 12 }}>{label}</div>
      <div style={{ flex: 1, color: "var(--fg)", fontWeight: 500 }}>{value || "—"}</div>
    </div>
  );
}

/* Redact step — AI-detected PII list + preview with blackout overlays */
function RedactStep({ form, setForm, currentUser }) {
  const defaultRedactions = [
    { id: "rd_1", kind: "Name",    text: currentUser.name,       page: 1, confidence: 0.99, on: true },
    { id: "rd_2", kind: "RIN",     text: "661234567",            page: 1, confidence: 0.96, on: true },
    { id: "rd_3", kind: "Email",   text: `${currentUser.name.toLowerCase().replace(" ", ".")}@rpi.edu`, page: 1, confidence: 0.98, on: true },
    { id: "rd_4", kind: "Handwritten signature", text: "— top right corner", page: 1, confidence: 0.82, on: true },
    { id: "rd_5", kind: "Name",    text: currentUser.name,       page: 14, confidence: 0.97, on: true },
  ];
  const [items, setItems] = useStateBW(form.redactions?.items || defaultRedactions);
  const [addingCustom, setAddingCustom] = useStateBW(false);

  const activeCount = items.filter(x => x.on).length;

  // Sync back to form
  React.useEffect(() => {
    setForm(f => ({ ...f, redactions: { items, count: activeCount }}));
  }, [items, activeCount]);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, padding: 12, background: "var(--primary-soft)", borderRadius: "var(--radius-sm)" }}>
        {React.cloneElement(window.I.sparkles, { style: { width: 16, height: 16, color: "var(--primary)", flexShrink: 0 }})}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>AI scan complete <window.Proposed note="Proposed — on-device vision model detects PII" /></div>
          <div className="text-xs text-muted" style={{ marginTop: 2 }}>Found {items.length} items that look like your identity. Review each — we'll black them out before upload.</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        {/* Preview */}
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>PREVIEW — PAGE 1</div>
          <div style={{ aspectRatio: "3 / 4", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 16, display: "flex", flexDirection: "column", gap: 6, position: "relative", overflow: "hidden" }}>
            {/* Header with "redacted" top bar */}
            <div style={{ display: "flex", gap: 4, alignItems: "baseline" }}>
              <span style={{ fontSize: 10, color: "var(--fg-muted)" }}>Name:</span>
              {items[0].on ? (
                <div style={{ height: 10, width: 80, background: "var(--fg)", borderRadius: 1 }} />
              ) : (
                <div style={{ fontSize: 10, color: "var(--danger-text)" }}>{items[0].text}</div>
              )}
              <span style={{ marginLeft: 12, fontSize: 10, color: "var(--fg-muted)" }}>RIN:</span>
              {items[1].on ? (
                <div style={{ height: 10, width: 60, background: "var(--fg)", borderRadius: 1 }} />
              ) : (
                <div style={{ fontSize: 10, color: "var(--danger-text)", fontFamily: "var(--font-mono)" }}>{items[1].text}</div>
              )}
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "baseline" }}>
              <span style={{ fontSize: 10, color: "var(--fg-muted)" }}>Email:</span>
              {items[2].on ? (
                <div style={{ height: 10, width: 130, background: "var(--fg)", borderRadius: 1 }} />
              ) : (
                <div style={{ fontSize: 10, color: "var(--danger-text)" }}>{items[2].text}</div>
              )}
            </div>
            <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />
            <div style={{ fontSize: 11, fontWeight: 600 }}>Problem 1.</div>
            <div style={{ height: 5, width: "95%", background: "var(--bg-muted)", borderRadius: 1 }} />
            <div style={{ height: 5, width: "90%", background: "var(--bg-muted)", borderRadius: 1 }} />
            <div style={{ height: 5, width: "60%", background: "var(--bg-muted)", borderRadius: 1 }} />
            <div style={{ fontSize: 11, fontWeight: 600, marginTop: 8 }}>Problem 2.</div>
            <div style={{ height: 5, width: "88%", background: "var(--bg-muted)", borderRadius: 1 }} />
            <div style={{ height: 5, width: "94%", background: "var(--bg-muted)", borderRadius: 1 }} />
            {/* Signature in corner */}
            <div style={{ position: "absolute", top: 10, right: 10, fontSize: 10, color: "var(--fg-muted)", fontStyle: "italic" }}>
              {items[3].on ? (
                <div style={{ height: 12, width: 50, background: "var(--fg)", borderRadius: 1 }} />
              ) : (
                <div style={{ fontSize: 9, fontFamily: "cursive", color: "var(--danger-text)" }}>{currentUser.name}</div>
              )}
            </div>
          </div>
        </div>

        {/* Detected items */}
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>DETECTED — {activeCount}/{items.length} REDACTED</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflow: "auto" }}>
            {items.map(it => (
              <label key={it.id} style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: 10,
                background: it.on ? "var(--bg-card)" : "var(--bg-muted)",
                border: `1px solid ${it.on ? "var(--border)" : "var(--border)"}`,
                borderRadius: "var(--radius-sm)", cursor: "pointer",
                opacity: it.on ? 1 : 0.55,
              }}>
                <input type="checkbox" checked={it.on} onChange={e => setItems(items.map(x => x.id === it.id ? { ...x, on: e.target.checked } : x))} style={{ marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{it.kind}</span>
                    <span className="chip" style={{ fontSize: 9 }}>p. {it.page}</span>
                    <span className="text-xs text-muted" style={{ marginLeft: "auto", fontFamily: "var(--font-mono)" }}>{Math.round(it.confidence * 100)}%</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-muted)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.text}</div>
                </div>
              </label>
            ))}
            {addingCustom ? (
              <div style={{ padding: 10, border: "1px dashed var(--border-strong)", borderRadius: "var(--radius-sm)", display: "flex", gap: 6 }}>
                <input className="input" placeholder="Text to black out…" style={{ flex: 1, fontSize: 12, padding: "6px 10px" }} autoFocus
                  onKeyDown={e => {
                    if (e.key === "Enter" && e.target.value) {
                      setItems([...items, { id: `rd_c${items.length}`, kind: "Custom", text: e.target.value, page: 1, confidence: 1.0, on: true }]);
                      setAddingCustom(false);
                    }
                    if (e.key === "Escape") setAddingCustom(false);
                  }}
                />
              </div>
            ) : (
              <button className="btn btn--sm" style={{ alignSelf: "flex-start", marginTop: 4 }} onClick={() => setAddingCustom(true)}>
                {React.cloneElement(window.I.plus, { style: { width: 12, height: 12 }})} Add custom redaction
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="text-xs" style={{ padding: 10, background: "var(--bg-muted)", borderRadius: "var(--radius-sm)", color: "var(--fg-muted)", display: "flex", gap: 8 }}>
        {React.cloneElement(window.I.lock, { style: { width: 12, height: 12, flexShrink: 0, marginTop: 1 }})}
        <div>Redactions run locally in your browser. The raw file never leaves your device — only the redacted copy is uploaded.</div>
      </div>
    </>
  );
}

Object.assign(window, { BackworkScreen });
