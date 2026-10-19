"use client";

import { useEffect, useState } from "react";
import {
  adminLogin,
  adminLogout,
  isLoggedIn,
  listBusinesses,
  createBusiness,
  updateBusiness,
  deleteBusiness,
  setBusinessStatus,
  getTemplates,
  getDashboard,
  qrUrl,
  DEFAULT_RATING_OPTIONS,
  APIError,
  getErrorMessage,
  isAbortError,
  type BackendBusiness,
  type BusinessInput,
  type Template,
  type DashboardStats,
  type BackendCategory,
  type BackendRatingOption,
} from "@/lib/api";

const BUSINESS_TYPES = [
  "Business",
  "Restaurant / Cafe",
  "Salon",
  "Hotel",
  "Software company / Agency",
];

function emptyForm(): BusinessInput {
  return {
    name: "",
    business_type: "Business",
    logo_url: null,
    brand_color: "#4F46E5",
    welcome_message:
      "We'd love to hear about your experience. It only takes a minute.",
    status: "active",
    review_destination_url: null,
    categories: [
      { id: undefined, name: "Quality of Product or Service", description: "", required: true },
      { id: undefined, name: "Customer Service", description: "", required: true },
      { id: undefined, name: "Overall Experience", description: "", required: false },
    ],
    rating_options: DEFAULT_RATING_OPTIONS.map((o) => ({ ...o })),
  };
}

function businessToForm(b: BackendBusiness): BusinessInput {
  return {
    name: b.name,
    business_type: b.business_type,
    logo_url: b.logo_url,
    brand_color: b.brand_color,
    welcome_message: b.welcome_message,
    status: b.status,
    review_destination_url: b.review_destination_url,
    categories: b.categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      required: c.required,
    })),
    rating_options: b.rating_options.map((r) => ({ ...r })),
  };
}

/** Returns a list of problems; empty means the form can be sent to the backend. */
function validateForm(form: BusinessInput): string[] {
  const problems: string[] = [];
  if (!form.name.trim()) problems.push("Business name is empty.");
  if (form.categories.length === 0) problems.push("Add at least one question.");
  form.categories.forEach((c, i) => {
    if (!c.name.trim()) problems.push(`Question ${i + 1} has no name.`);
  });
  if (form.rating_options.length < 2) problems.push("Add at least two rating options.");
  form.rating_options.forEach((r, i) => {
    if (!r.label.trim()) problems.push(`Rating option ${i + 1} has no label.`);
  });
  const names = form.categories.map((c) => c.name.trim().toLowerCase()).filter(Boolean);
  if (new Set(names).size !== names.length) problems.push("Question names must be unique.");
  const labels = form.rating_options.map((r) => r.label.trim().toLowerCase()).filter(Boolean);
  if (new Set(labels).size !== labels.length) problems.push("Rating labels must be unique.");
  return problems;
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const [businesses, setBusinesses] = useState<BackendBusiness[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [dashboard, setDashboard] = useState<DashboardStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const [form, setForm] = useState<BusinessInput>(emptyForm());

  // ---- Auth check on mount ----
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAuthed(isLoggedIn());
    setChecking(false);
  }, []);

  // ---- Load data when authenticated ----
  useEffect(() => {
    if (!authed) return;
    const controller = new AbortController();
    (async () => {
      setLoading(true);
      setError("");
      try {
        const [biz, tmpl, dash] = await Promise.all([
          listBusinesses(controller.signal),
          getTemplates(controller.signal),
          getDashboard(controller.signal),
        ]);
        setBusinesses(biz);
        setTemplates(tmpl);
        setDashboard(dash);
        if (biz.length > 0) {
          setSelectedId(biz[0].id);
          setForm(businessToForm(biz[0]));
        }
      } catch (err) {
        if (isAbortError(err)) return;
        handleApiError(err);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  // ---- Load selected business into form ----
  useEffect(() => {
    if (!selectedId) return;
    const biz = businesses.find((b) => b.id === selectedId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (biz) setForm(businessToForm(biz));
    setSaved(false);
    setError("");
    setShowErrors(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  /** 401 anywhere means the session is gone: drop the token and show the login screen. */
  function handleApiError(err: unknown) {
    if (err instanceof APIError && err.status === 401) {
      handleLogout();
      setLoginError("Your session expired. Please log in again.");
      return;
    }
    setError(getErrorMessage(err));
  }

  function refreshDashboard() {
    // Non-blocking: counts update in the background after a mutation.
    getDashboard()
      .then(setDashboard)
      .catch((err) => {
        if (err instanceof APIError && err.status === 401) handleApiError(err);
      });
  }

  /** Runs one admin mutation with a busy flag so buttons cannot be double-clicked. */
  async function runMutation(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      await action();
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  }

  function checkForm(): boolean {
    const problems = validateForm(form);
    if (problems.length > 0) {
      setShowErrors(true);
      setError(problems.join(" "));
      return false;
    }
    setShowErrors(false);
    return true;
  }

  // ---- Login ----
  async function handleLogin() {
    if (loggingIn || !password) return;
    setLoggingIn(true);
    setLoginError("");
    try {
      await adminLogin(password);
      setAuthed(true);
    } catch (err) {
      setLoginError(getErrorMessage(err));
    } finally {
      setPassword("");
      setLoggingIn(false);
    }
  }

  function handleLogout() {
    adminLogout();
    setAuthed(false);
    setBusinesses([]);
    setSelectedId("");
    setDashboard(null);
    setTemplates([]);
    setForm(emptyForm());
    setError("");
  }

  // ---- Save (update) ----
  function handleSave() {
    if (!selectedId || !checkForm()) return;
    void runMutation(async () => {
      const updated = await updateBusiness(selectedId, form);
      setBusinesses((prev) => prev.map((b) => (b.id === selectedId ? updated : b)));
      setForm(businessToForm(updated));
      setSaved(true);
    });
  }

  // ---- Create ----
  function handleCreate() {
    if (!checkForm()) return;
    void runMutation(async () => {
      const created = await createBusiness(form);
      setBusinesses((prev) => [created, ...prev]);
      setSelectedId(created.id);
      setForm(businessToForm(created));
      setShowCreate(false);
      setSaved(true);
      refreshDashboard();
    });
  }

  // ---- Delete ----
  function handleDelete() {
    if (!selectedId) return;
    if (!window.confirm(`Delete "${form.name}"? This cannot be undone.`)) return;
    const id = selectedId;
    void runMutation(async () => {
      await deleteBusiness(id);
      const remaining = businesses.filter((b) => b.id !== id);
      setBusinesses(remaining);
      if (remaining.length > 0) {
        setSelectedId(remaining[0].id);
        setForm(businessToForm(remaining[0]));
      } else {
        setSelectedId("");
        setForm(emptyForm());
      }
      refreshDashboard();
    });
  }

  // ---- Toggle status ----
  function handleToggleStatus() {
    if (!selectedId) return;
    const id = selectedId;
    const newStatus = form.status === "active" ? "inactive" : "active";
    void runMutation(async () => {
      const updated = await setBusinessStatus(id, newStatus);
      setForm((f) => ({ ...f, status: updated.status }));
      setBusinesses((prev) => prev.map((b) => (b.id === id ? updated : b)));
      refreshDashboard();
    });
  }

  // ---- Category helpers ----
  function addCategory() {
    setForm((f) => ({
      ...f,
      categories: [
        ...f.categories,
        { id: undefined, name: "", description: "", required: true },
      ],
    }));
  }

  function updateCategory(index: number, patch: Partial<BackendCategory>) {
    setForm((f) => ({
      ...f,
      categories: f.categories.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }));
  }

  function deleteCategory(index: number) {
    setForm((f) => ({
      ...f,
      categories: f.categories.filter((_, i) => i !== index),
    }));
  }

  function moveCategory(index: number, dir: -1 | 1) {
    setForm((f) => {
      const cats = [...f.categories];
      const target = index + dir;
      if (target < 0 || target >= cats.length) return f;
      [cats[index], cats[target]] = [cats[target], cats[index]];
      return { ...f, categories: cats };
    });
  }

  // ---- Rating option helpers ----
  function updateRatingOption(index: number, patch: Partial<BackendRatingOption>) {
    setForm((f) => ({
      ...f,
      rating_options: f.rating_options.map((r, i) =>
        i === index ? { ...r, ...patch } : r
      ),
    }));
  }

  function moveRatingOption(index: number, dir: -1 | 1) {
    setForm((f) => {
      const opts = [...f.rating_options];
      const target = index + dir;
      if (target < 0 || target >= opts.length) return f;
      [opts[index], opts[target]] = [opts[target], opts[index]];
      return { ...f, rating_options: opts };
    });
  }

  async function copyCustomerUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      setError("Could not copy automatically. Select the URL below and copy it.");
    }
  }

  function addRatingOption() {
    setForm((f) => ({
      ...f,
      rating_options: [...f.rating_options, { label: "", score: 1 }],
    }));
  }

  function deleteRatingOption(index: number) {
    setForm((f) => ({
      ...f,
      rating_options:
        f.rating_options.length <= 2
          ? f.rating_options
          : f.rating_options.filter((_, i) => i !== index),
    }));
  }

  // ---- Apply template ----
  function applyTemplate(key: string) {
    const tmpl = templates.find((t) => t.key === key);
    if (!tmpl) return;
    setForm((f) => ({
      ...f,
      business_type: tmpl.label,
      categories: tmpl.categories.map((c) => ({
        id: undefined,
        name: c.name,
        description: c.description,
        required: c.required,
      })),
      rating_options: tmpl.rating_options.map((r) => ({ ...r })),
    }));
  }

  const selectedBusiness = businesses.find((b) => b.id === selectedId);
  const unsaved =
    !!selectedBusiness &&
    JSON.stringify(form) !== JSON.stringify(businessToForm(selectedBusiness));

  // ===================== RENDER =====================

  if (checking) {
    return (
      <main className="admin-shell">
        <div className="panel" style={{ margin: 32, padding: 24 }}>
          Loading...
        </div>
      </main>
    );
  }

  // ---- Login screen ----
  if (!authed) {
    return (
      <main className="admin-shell">
        <header className="topbar">
          <a className="brand" href="/admin">
            <span className="brand-mark">*</span>
            <span>
              ReviewBoost <b>AI</b>
            </span>
          </a>
          <span className="topbar-note">TURN FEEDBACK INTO GROWTH</span>
        </header>

        <section className="admin-hero">
          <p className="eyebrow">ADMIN LOGIN</p>
          <h1>
            Admin <span>Panel</span>
          </h1>
          <p>Enter your password to manage your businesses.</p>
        </section>

        <section
          className="panel"
          style={{
            maxWidth: 420,
            margin: "0 auto 60px",
            padding: 32,
          }}
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">SECURE ACCESS</p>
              <h2>Password</h2>
            </div>
            <span className="heading-icon">L</span>
          </div>

          <div style={{ display: "grid", gap: 16, marginTop: 20 }}>
            <label className="field">
              Admin password
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleLogin();
                }}
                placeholder="Enter password"
              />
            </label>

            {loginError && (
              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: "#fff1f2",
                  border: "1px solid #fecdd3",
                  color: "#9f1239",
                  fontSize: 12,
                }}
              >
                {loginError}
              </div>
            )}

            <button
              type="button"
              className="primary-button full-width"
              onClick={handleLogin}
              disabled={loggingIn || !password}
            >
              {loggingIn ? "Logging in..." : "Log in"}
            </button>
          </div>
        </section>
      </main>
    );
  }

  // ---- Admin panel ----
  return (
    <main className="admin-shell">
      <header className="topbar">
        <a className="brand" href="/admin">
          <span className="brand-mark">*</span>
          <span>
            ReviewBoost <b>AI</b>
          </span>
        </a>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span className="topbar-note">CONNECTED TO BACKEND</span>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              padding: "8px 14px",
              border: "1px solid rgba(141, 185, 240, 0.25)",
              borderRadius: 10,
              color: "#dcecff",
              background: "rgba(255, 255, 255, 0.045)",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Log out
          </button>
        </div>
      </header>

      <section className="admin-hero">
        <p className="eyebrow">BUSINESS WORKSPACE</p>
        <h1>
          Admin <span>Panel</span>
        </h1>
        <p>
          Configure your business, customize feedback, and create your QR code.
          Data is stored on the server.
        </p>
      </section>

      {dashboard && (
        <section
          style={{
            maxWidth: 1200,
            margin: "0 auto 20px",
            padding: "0 20px",
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          {[
            { label: "Businesses", value: dashboard.total_businesses },
            { label: "Active", value: dashboard.active_businesses },
            { label: "Visits", value: dashboard.total_visits },
            { label: "Drafts", value: dashboard.drafts_generated },
            { label: "Copy & Open", value: dashboard.copy_and_open_clicks },
          ].map((stat) => (
            <div
              key={stat.label}
              className="panel"
              style={{ flex: "1 1 140px", padding: "16px 18px" }}
            >
              <p className="eyebrow">{stat.label.toUpperCase()}</p>
              <p style={{ margin: "6px 0 0", fontSize: 28, fontWeight: 800 }}>
                {stat.value}
              </p>
            </div>
          ))}
          {dashboard.recent_activity.length > 0 && (
            <div className="panel" style={{ flex: "1 1 100%", padding: "16px 18px" }}>
              <p className="eyebrow">RECENT ACTIVITY</p>
              <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
                {dashboard.recent_activity.slice(0, 6).map((a, i) => (
                  <li key={`${a.created_at}-${i}`} className="muted" style={{ fontSize: 12 }}>
                    <strong style={{ color: "#dce9fa" }}>{a.business_name}</strong>{" "}
                    {a.event_type === "visit"
                      ? "page opened"
                      : a.event_type === "draft_generated"
                        ? "review draft generated"
                        : "Copy & Open clicked"}{" "}
                    <span>{new Date(a.created_at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>{dashboard.note}</p>
            </div>
          )}
        </section>
      )}

      <section className="admin-layout">
        {/* Sidebar */}
        <aside className="panel sidebar">
          <div className="section-heading">
            <div>
              <p className="eyebrow">WORKSPACE</p>
              <h2>Your businesses</h2>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                setError("");
                setForm(emptyForm());
                setShowCreate(true);
              }}
              aria-label="Add business"
              title="Add business"
            >
              +
            </button>
          </div>

          <div className="business-list">
            {loading && businesses.length === 0 && (
              <p className="muted" style={{ padding: 10 }}>
                Loading...
              </p>
            )}
            {!loading && businesses.length === 0 && (
              <p className="muted" style={{ padding: 10 }}>
                No businesses yet. Create one to get started.
              </p>
            )}
            {businesses.map((item) => (
              <button
                type="button"
                key={item.id}
                className={"business-item " + (item.id === selectedId ? "active" : "")}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="business-avatar">
                  {item.name.slice(0, 1).toUpperCase() || "B"}
                </span>
                <span className="business-item-text">
                  <strong>{item.name}</strong>
                  <small>{item.business_type}</small>
                </span>
                <span className={"status-dot " + (item.status === "active" ? "" : "inactive")} />
              </button>
            ))}
          </div>

          <button
            type="button"
            className="secondary-button full-width"
            onClick={() => {
              setError("");
              setForm(emptyForm());
              setShowCreate(true);
            }}
          >
            + Add another business
          </button>

          <div className="sidebar-tip">
            <span>*</span>
            <p>Each business gets its own questions and customer QR link.</p>
          </div>
        </aside>

        {/* Main area */}
        {selectedBusiness ? (
          <div className="admin-main">
            <div className="page-heading">
              <div>
                <p className="eyebrow">BUSINESS CONFIGURATION</p>
                <h2>{form.name || "Untitled"}</h2>
                <p className="muted">Configure your details, then save your changes.</p>
              </div>
              <span className={"status-pill " + (form.status === "active" ? "" : "")}>
                {form.status === "active" ? "Active" : "Inactive"}
              </span>
            </div>

            {/* Profile */}
            <section className="panel form-panel">
              <div className="section-heading">
                <div>
                  <span className="step-label">01 / BUSINESS PROFILE</span>
                  <h3>Make it yours</h3>
                </div>
                <span className="heading-icon">H</span>
              </div>

              <div className="form-grid">
                <label className="field">
                  Business name
                  <input
                    value={form.name}
                    aria-invalid={showErrors && !form.name.trim()}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g. Bluebird Cafe"
                  />
                </label>

                <label className="field">
                  Business type
                  <select
                    value={form.business_type}
                    onChange={(e) => setForm({ ...form, business_type: e.target.value })}
                  >
                    {BUSINESS_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field field-wide">
                  Welcome message
                  <textarea
                    value={form.welcome_message}
                    onChange={(e) => setForm({ ...form, welcome_message: e.target.value })}
                    rows={2}
                    placeholder="Write a friendly welcome message."
                  />
                </label>

                <label className="field">
                  Logo URL (optional)
                  <input
                    type="url"
                    value={form.logo_url || ""}
                    onChange={(e) => setForm({ ...form, logo_url: e.target.value || null })}
                    placeholder="https://..."
                  />
                </label>

                <label className="field">
                  Review destination URL
                  <input
                    type="url"
                    value={form.review_destination_url || ""}
                    onChange={(e) =>
                      setForm({ ...form, review_destination_url: e.target.value || null })
                    }
                    placeholder="https://maps.google.com/..."
                  />
                  <small>Where customers go to post their review.</small>
                </label>

                <label className="field">
                  Accent color
                  <div className="color-input">
                    <input
                      type="color"
                      value={form.brand_color}
                      onChange={(e) => setForm({ ...form, brand_color: e.target.value })}
                    />
                    <span>{form.brand_color.toUpperCase()}</span>
                  </div>
                </label>

                <label className="field">
                  Status
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value as "active" | "inactive" })}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              </div>

              {templates.length > 0 && (
                <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <span className="muted" style={{ fontSize: 11, fontWeight: 700 }}>
                    Quick template:
                  </span>
                  {templates.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className="secondary-button"
                      style={{ minHeight: 32, padding: "6px 12px", fontSize: 11 }}
                      onClick={() => applyTemplate(t.key)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Categories */}
            <section className="panel form-panel">
              <div className="section-heading">
                <div>
                  <span className="step-label">02 / FEEDBACK QUESTIONS</span>
                  <h3>Customize your questions</h3>
                  <p className="muted">Each question gets a name and description.</p>
                </div>
                <span className="heading-icon">Q</span>
              </div>

              <div className="category-list">
                {form.categories.map((cat, index) => (
                  <div className="category-editor" key={index}>
                    <div className="category-number">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div className="category-fields">
                      <label className="field">
                        Question name
                        <input
                          value={cat.name}
                          aria-invalid={showErrors && !cat.name.trim()}
                          onChange={(e) => updateCategory(index, { name: e.target.value })}
                          placeholder="e.g. Food Quality"
                        />
                      </label>
                      <label className="field">
                        Description (optional)
                        <input
                          value={cat.description}
                          onChange={(e) => updateCategory(index, { description: e.target.value })}
                          placeholder="Help text for this question"
                        />
                      </label>
                      <label className="field" style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={cat.required}
                          onChange={(e) => updateCategory(index, { required: e.target.checked })}
                        />
                        <span>Required</span>
                      </label>
                    </div>
                    <div className="category-actions">
                      <button type="button" className="tiny-button" onClick={() => moveCategory(index, -1)} disabled={index === 0} title="Move up">^</button>
                      <button type="button" className="tiny-button" onClick={() => moveCategory(index, 1)} disabled={index === form.categories.length - 1} title="Move down">v</button>
                      <button type="button" className="tiny-button danger" onClick={() => deleteCategory(index)} title="Delete">x</button>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" className="secondary-button" onClick={addCategory}>
                + Add question
              </button>
            </section>

            {/* Rating options */}
            <section className="panel form-panel">
              <div className="section-heading">
                <div>
                  <span className="step-label">03 / RATING OPTIONS</span>
                  <h3>Rating choices</h3>
                  <p className="muted">These options apply to all questions. Score 1-5 (higher = better).</p>
                </div>
                <span className="heading-icon">R</span>
              </div>

              <div className="category-list">
                {form.rating_options.map((opt, index) => (
                  <div className="category-editor" key={index}>
                    <div className="category-number">{String(index + 1).padStart(2, "0")}</div>
                    <div className="category-fields" style={{ gridTemplateColumns: "1fr 80px" }}>
                      <label className="field">
                        Label
                        <input
                          value={opt.label}
                          aria-invalid={showErrors && !opt.label.trim()}
                          onChange={(e) => updateRatingOption(index, { label: e.target.value })}
                          placeholder="e.g. Excellent"
                        />
                      </label>
                      <label className="field">
                        Score
                        <input
                          type="number"
                          min={1}
                          max={5}
                          value={opt.score}
                          onChange={(e) => updateRatingOption(index, { score: parseInt(e.target.value) || 1 })}
                        />
                      </label>
                    </div>
                    <div className="category-actions">
                      <button type="button" className="tiny-button" onClick={() => moveRatingOption(index, -1)} disabled={index === 0} title="Move up" aria-label={`Move rating option ${index + 1} up`}>^</button>
                      <button type="button" className="tiny-button" onClick={() => moveRatingOption(index, 1)} disabled={index === form.rating_options.length - 1} title="Move down" aria-label={`Move rating option ${index + 1} down`}>v</button>
                      <button type="button" className="tiny-button danger" onClick={() => deleteRatingOption(index)} disabled={form.rating_options.length <= 2} title="Delete" aria-label={`Delete rating option ${index + 1}`}>x</button>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" className="secondary-button" onClick={addRatingOption}>
                + Add rating option
              </button>
            </section>

            {/* QR code */}
            <section className="panel qr-panel">
              <div className="section-heading">
                <div>
                  <span className="step-label">04 / QR CODE</span>
                  <h3>Your customer QR code</h3>
                  <p className="muted">Scan this code to open the customer feedback page.</p>
                </div>
                <span className="heading-icon">#</span>
              </div>

              <div className="qr-layout">
                <div className="qr-preview">
                  <div className="qr-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrUrl(selectedBusiness.id)}
                      alt={`QR code linking to the customer feedback page for ${selectedBusiness.name}`}
                      width={240}
                      height={240}
                      decoding="async"
                      style={{ display: "block" }}
                    />
                  </div>
                  <span className="qr-caption">SCAN TO OPEN FEEDBACK</span>
                </div>

                <div className="qr-info">
                  <span className="status-pill">QR READY</span>
                  <h4>Ready to share your feedback page?</h4>
                  <p className="muted">
                    The QR code always opens this business&apos;s ReviewBoost page (never the
                    review site directly), so you can change questions later without reprinting it.
                  </p>
                  {unsaved && (
                    <p className="notice" role="status" style={{ marginTop: 0, marginBottom: 12 }}>
                      You have unsaved changes. Customers and the preview see the last saved version.
                    </p>
                  )}

                  <div className="button-stack">
                    <button type="button" className="primary-button" onClick={handleSave} disabled={busy || !unsaved}>
                      {busy ? "Saving..." : unsaved ? "Save changes" : "All changes saved"}
                    </button>
                    <a
                      className="secondary-button"
                      href={`/review/${encodeURIComponent(selectedBusiness.id)}?preview=true`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ textDecoration: "none" }}
                      aria-disabled={form.status !== "active"}
                      onClick={(e) => {
                        if (selectedBusiness.status !== "active") {
                          e.preventDefault();
                          setError("Activate this business before previewing its customer page.");
                        }
                      }}
                    >
                      Preview customer page {"\u2197"}
                    </a>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => copyCustomerUrl(selectedBusiness.customer_url)}
                    >
                      {copiedUrl ? "Customer URL copied" : "Copy customer URL"}
                    </button>
                    <a
                      className="secondary-button"
                      href={qrUrl(selectedBusiness.id, true)}
                      style={{ textDecoration: "none" }}
                    >
                      Download QR (PNG)
                    </a>
                    <button type="button" className="secondary-button" onClick={handleToggleStatus} disabled={busy}>
                      {form.status === "active" ? "Deactivate" : "Activate"}
                    </button>
                    <button type="button" className="text-button danger-text" onClick={handleDelete} disabled={busy}>
                      Delete this business
                    </button>
                  </div>

                  {saved && <p className="success-message">Settings saved on server.</p>}

                  <p className="url-label">Customer URL</p>
                  <code className="url-box">{selectedBusiness.customer_url}</code>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <div className="panel empty-panel">
            <h2>No business selected</h2>
            <p>Create a business to configure feedback and generate its QR code.</p>
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setForm(emptyForm());
                setShowCreate(true);
              }}
            >
              + Create business
            </button>
          </div>
        )}
      </section>

      {error && (
        <div
          role="alert"
          style={{
            position: "fixed",
            left: 16,
            right: 16,
            bottom: 16,
            zIndex: 2000,
            maxWidth: 700,
            margin: "auto",
            padding: 16,
            borderRadius: 12,
            background: "#fff1f2",
            border: "1px solid #fecdd3",
            color: "#9f1239",
            boxShadow: "0 8px 30px #00000014",
          }}
        >
          <strong>Notice:</strong> {error}
          <button type="button" onClick={() => setError("")} style={{ float: "right", border: 0, background: "transparent", cursor: "pointer", fontSize: 18 }}>
            x
          </button>
        </div>
      )}

      <footer className="footer">
        ReviewBoost AI <span>Connected to backend server.</span>
      </footer>

      {/* Create modal */}
      {showCreate && (
        <div
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setShowCreate(false);
              setError("");
            }
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(2, 12, 30, 0.78)",
            backdropFilter: "blur(12px)",
            display: "grid",
            placeItems: "center",
            padding: 20,
            overflowY: "auto",
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-business-title"
            className="panel"
            style={{
              width: "min(100%, 520px)",
              padding: 28,
              background: "#102b4c",
              border: "1px solid rgba(125, 185, 255, 0.35)",
              borderRadius: 22,
              boxShadow: "0 25px 80px rgba(0,0,0,0.45)",
            }}
          >
            <p className="eyebrow">NEW BUSINESS</p>
            <h2 id="create-business-title" style={{ marginTop: 8 }}>
              Create a business
            </h2>
            <p className="muted">Set up a business, then customize its feedback questions.</p>

            <div style={{ display: "grid", gap: 16, marginTop: 22 }}>
              <label className="field">
                Business name
                <input
                  autoFocus
                  value={form.name}
                  aria-invalid={showErrors && !form.name.trim()}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Bluebird Cafe"
                />
              </label>

              <label className="field">
                Business type
                <select
                  value={form.business_type}
                  onChange={(e) => setForm({ ...form, business_type: e.target.value })}
                >
                  {BUSINESS_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                Review destination URL
                <input
                  type="url"
                  value={form.review_destination_url || ""}
                  onChange={(e) => setForm({ ...form, review_destination_url: e.target.value || null })}
                  placeholder="https://..."
                />
                <small>Enter the real review page URL.</small>
              </label>
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
              <button type="button" className="primary-button" onClick={handleCreate} disabled={busy}>
                {busy ? "Creating..." : "Create & Generate QR"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setShowCreate(false);
                  setError("");
                  if (selectedBusiness) setForm(businessToForm(selectedBusiness));
                }}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
