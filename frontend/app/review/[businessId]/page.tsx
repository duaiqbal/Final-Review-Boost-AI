"use client";

import { Suspense, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  getPublicBusiness,
  generateReview,
  trackCopyAndOpen,
  APIError,
  getErrorMessage,
  isAbortError,
  type PublicBusiness,
  type GenerateReviewResult,
} from "@/lib/api";

type Answers = Record<string, string>;
type Step = "welcome" | "feedback" | "draft" | "done";

const SLOW_AFTER_MS = 2500; // show a "waking up" message if the backend is slow (cold start)
const RETRY_DELAYS_MS = [2000, 4000]; // retries for network failures only
const MAX_COMMENT = 500;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

/** Copy text; falls back to a hidden textarea when the async Clipboard API is unavailable. */
function copyText(text: string): Promise<boolean> {
  const legacy = (): boolean => {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  };
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(
        () => true,
        () => legacy()
      );
    }
  } catch {
    /* fall through */
  }
  return Promise.resolve(legacy());
}

function ReviewContent() {
  const params = useParams<{ businessId: string }>();
  const searchParams = useSearchParams();
  const preview = searchParams.get("preview") === "true";

  const [business, setBusiness] = useState<PublicBusiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [inactive, setInactive] = useState(false);

  const [step, setStep] = useState<Step>("welcome");
  const [answers, setAnswers] = useState<Answers>({});
  const [comment, setComment] = useState("");
  const [draft, setDraft] = useState<GenerateReviewResult | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState<boolean | null>(null);
  const [opened, setOpened] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // ---- Load the business this QR code belongs to ----
  useEffect(() => {
    const controller = new AbortController();
    const slowTimer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const data = await getPublicBusiness(params.businessId, preview, controller.signal);
          setBusiness(data);
          break;
        } catch (err) {
          if (isAbortError(err)) return;
          const retryable = err instanceof APIError && err.code === "network";
          if (retryable && attempt < RETRY_DELAYS_MS.length) {
            await wait(RETRY_DELAYS_MS[attempt], controller.signal);
            if (controller.signal.aborted) return;
            continue;
          }
          if (err instanceof APIError && err.code === "business_inactive") setInactive(true);
          else if (err instanceof APIError && err.status === 404)
            setLoadError("Please scan the latest QR code provided by the business.");
          else setLoadError(getErrorMessage(err));
          break;
        }
      }
      clearTimeout(slowTimer);
      setLoading(false);
    })();
    return () => {
      clearTimeout(slowTimer);
      controller.abort();
    };
  }, [params.businessId, preview]);

  // Move focus to the new screen heading so keyboard and screen-reader users follow the flow.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const accent = business?.brand_color || "#2878F0";
  const styles = { "--rb-accent": accent } as CSSProperties;
  const categories = business?.categories ?? [];
  const answeredCount = categories.filter((c) => Boolean(answers[c.id])).length;
  const missingRequired = categories.filter((c) => c.required && !answers[c.id]);

  function go(next: Step) {
    setError("");
    setNotice("");
    setStep(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectOption(categoryId: string, label: string) {
    setAnswers((cur) => ({ ...cur, [categoryId]: cur[categoryId] === label ? "" : label }));
    setError("");
  }

  async function requestDraft(regenerate: boolean) {
    if (!business || submitting) return;
    if (missingRequired.length > 0) {
      setError("Please answer: " + missingRequired.map((m) => m.name).join(", ") + ".");
      return;
    }
    if (answeredCount === 0 && !comment.trim()) {
      setError("Choose at least one rating or write a short comment.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const answerList = Object.entries(answers)
        .filter(([, rating]) => rating)
        .map(([category_id, rating]) => ({ category_id, rating }));
      const result = await generateReview(business.id, answerList, comment.trim(), regenerate);
      setDraft(result);
      setText(result.review);
      setNotice(result.warnings.join(" "));
      setCopied(null);
      if (step !== "draft") go("draft");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    const ok = await copyText(text);
    setCopied(ok);
    if (!ok) selectDraft();
  }

  function selectDraft() {
    draftRef.current?.focus();
    draftRef.current?.select();
  }

  function handleCopyAndOpen() {
    if (!business) return;
    // Start the copy and open the tab inside the same click so browsers keep the user gesture.
    const copyPromise = copyText(text);
    let win: Window | null = null;
    if (business.review_destination_url) {
      win = window.open(business.review_destination_url, "_blank");
      if (win) win.opener = null;
    }
    if (!preview) trackCopyAndOpen(business.id).catch(() => {});
    void copyPromise.then((ok) => {
      setCopied(ok);
      setOpened(Boolean(win));
      go("done");
    });
  }

  function startOver() {
    setAnswers({});
    setComment("");
    setDraft(null);
    setText("");
    setCopied(null);
    setOpened(false);
    go("welcome");
  }

  // ---------------- states before the flow ----------------
  if (loading) {
    return (
      <main className="rb-page" style={styles}>
        <div className="rb-state">
          <span className="rb-brand-mark">*</span>
          <h1>{slow ? "Waking up the server" : "Getting things ready"}</h1>
          <p role="status" aria-live="polite">
            {slow ? "The first visit can take a few seconds. Thanks for waiting..." : "Just a moment..."}
          </p>
        </div>
      </main>
    );
  }

  if (inactive || loadError || !business) {
    return (
      <main className="rb-page" style={styles}>
        <div className="rb-state" role="alert">
          <span className="rb-brand-mark">*</span>
          <h1>{inactive ? "Feedback unavailable" : "Page not found"}</h1>
          <p>
            {inactive
              ? "This business has paused feedback for now. Please check back later."
              : loadError || "Please scan the latest QR code provided by the business."}
          </p>
        </div>
      </main>
    );
  }

  const stepIndex = { welcome: 1, feedback: 2, draft: 3, done: 4 }[step];

  return (
    <main className="rb-page" style={styles}>
      <div className="rb-background-glow rb-glow-one" />
      <div className="rb-background-glow rb-glow-two" />

      <header className="rb-topbar">
        <Link href="/" className="rb-brand" aria-label="ReviewBoost AI home">
          <span className="rb-brand-mark">*</span>
          <span>
            ReviewBoost <strong>AI</strong>
          </span>
        </Link>
        <span className="rb-top-note">Step {stepIndex} of 4</span>
      </header>

      <section className="rb-card" aria-live="polite">
        {preview && (
          <p className="rb-alert rb-alert-success" style={{ marginTop: 16 }}>
            <span>i</span>
            Admin preview: visits and Copy &amp; Open clicks are not counted.
          </p>
        )}

        <div className="rb-business">
          <div className="rb-business-avatar" aria-hidden="true">
            {business.logo_url ? (
              // Admin-entered logos can live on any host, so a fixed-size lazy <img> is used.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={business.logo_url}
                alt=""
                width={47}
                height={47}
                loading="lazy"
                decoding="async"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              business.name.trim().charAt(0).toUpperCase() || "B"
            )}
          </div>
          <div className="rb-business-details">
            <p style={{ margin: 0, color: "#16365e", fontSize: 16, fontWeight: 800 }}>{business.name}</p>
            <p>{business.business_type || "Local Business"}</p>
          </div>
          <span className="rb-secure-label">
            <span className="rb-status-dot" />
            Feedback
          </span>
        </div>

        {/* ---------------- Screen 1: Welcome ---------------- */}
        {step === "welcome" && (
          <>
            <div className="rb-intro">
              <span className="rb-kicker">A MOMENT FOR US</span>
              <h1 ref={headingRef} tabIndex={-1} className="rb-step-heading">
                How was your experience?
              </h1>
              <p>{business.welcome_message || "Tell us how it went. It only takes a minute."}</p>
            </div>
            <button type="button" className="rb-submit" onClick={() => go("feedback")}>
              <span>Start feedback</span>
              <span className="rb-submit-arrow">{"\u2192"}</span>
            </button>
            <div className="rb-honesty">
              <span>*</span>
              Any rating is welcome, including average or poor ones.
            </div>
          </>
        )}

        {/* ---------------- Screen 2: Feedback ---------------- */}
        {step === "feedback" && (
          <>
            <div className="rb-intro">
              <span className="rb-kicker">YOUR FEEDBACK</span>
              <h1 ref={headingRef} tabIndex={-1} className="rb-step-heading">
                Rate your visit
              </h1>
              <p>Questions marked * are required.</p>
            </div>

            <div className="rb-progress">
              <div className="rb-progress-track" aria-hidden="true">
                <div
                  className="rb-progress-fill"
                  style={{ width: `${categories.length ? (answeredCount / categories.length) * 100 : 0}%` }}
                />
              </div>
              <span>
                {answeredCount} of {categories.length} answered
              </span>
            </div>

            <div className="rb-category-list">
              {categories.map((category, index) => (
                <section className="rb-category" key={category.id}>
                  <div className="rb-category-heading">
                    <span className="rb-category-index">{String(index + 1).padStart(2, "0")}</span>
                    <h2 id={`cat-${category.id}`} style={{ margin: 0, flex: 1, color: "#1a385d", fontSize: 14 }}>
                      {category.name}
                      {category.required && <span aria-label="required"> *</span>}
                    </h2>
                    {answers[category.id] && <span className="rb-complete">{"\u2713"}</span>}
                  </div>
                  {category.description && (
                    <p style={{ margin: "0 0 10px", color: "#5f7390", fontSize: 12, lineHeight: 1.5 }}>
                      {category.description}
                    </p>
                  )}
                  <div className="rb-options" role="group" aria-labelledby={`cat-${category.id}`}>
                    {business.rating_options.map((option) => {
                      const selected = answers[category.id] === option.label;
                      return (
                        <button
                          type="button"
                          key={option.label}
                          className={"rb-option " + (selected ? "rb-option-selected" : "")}
                          aria-pressed={selected}
                          onClick={() => selectOption(category.id, option.label)}
                        >
                          <span className="rb-option-indicator" aria-hidden="true">
                            {selected ? "\u2713" : ""}
                          </span>
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <div className="rb-comment-section">
              <label htmlFor="rb-comment">
                Anything else to share?
                <span>OPTIONAL</span>
              </label>
              <textarea
                id="rb-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What stood out, good or bad?"
                maxLength={MAX_COMMENT}
                rows={3}
              />
              <div className="rb-comment-footer">
                <span>Please don&apos;t include phone numbers or emails.</span>
                <span>
                  {comment.length}/{MAX_COMMENT}
                </span>
              </div>
            </div>

            {error && (
              <div className="rb-alert rb-alert-error" role="alert">
                <span>!</span>
                <p>{error}</p>
              </div>
            )}

            <button
              type="button"
              className="rb-submit"
              onClick={() => requestDraft(false)}
              disabled={submitting}
            >
              <span>{submitting ? "Writing your draft..." : "Generate my review draft"}</span>
              {!submitting && <span className="rb-submit-arrow">{"\u2192"}</span>}
            </button>
            <button type="button" className="rb-reset" onClick={() => go("welcome")}>
              {"\u2190"} Back
            </button>
          </>
        )}

        {/* ---------------- Screen 3: Draft ---------------- */}
        {step === "draft" && draft && (
          <>
            <div className="rb-intro">
              <span className="rb-kicker">YOUR DRAFT</span>
              <h1 ref={headingRef} tabIndex={-1} className="rb-step-heading">
                Review and edit your draft
              </h1>
              <p>
                {draft.source === "ai"
                  ? "Written by AI from your answers only. Change anything that isn't accurate."
                  : "AI was unavailable, so this simple draft was built from your ratings. Feel free to edit it."}
              </p>
            </div>

            {notice && (
              <div className="rb-alert rb-alert-success" role="status">
                <span>i</span>
                <p>{notice}</p>
              </div>
            )}

            <div className="rb-fallback">
              <label htmlFor="rb-draft">Draft (editable)</label>
              <textarea
                id="rb-draft"
                ref={draftRef}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setCopied(null);
                }}
                rows={6}
              />
              <p style={{ margin: 0, color: "#5f7390", fontSize: 11, lineHeight: 1.6 }}>
                {draft.source === "ai"
                  ? draft.disclaimer
                  : "This draft was built from your ratings only. Please read it, edit it, and make sure it reflects your real experience before posting."}
              </p>
              {copied === true && <p className="rb-copy-ok" role="status">Copied to clipboard.</p>}
              {copied === false && (
                <p className="rb-alert rb-alert-error" role="alert" style={{ margin: 0 }}>
                  <span>!</span>
                  Automatic copy is blocked here. The text is selected: use your device&apos;s Copy option.
                </p>
              )}
            </div>

            {error && (
              <div className="rb-alert rb-alert-error" role="alert">
                <span>!</span>
                <p>{error}</p>
              </div>
            )}

            {business.review_destination_url ? (
              <button type="button" className="rb-submit" onClick={handleCopyAndOpen} disabled={!text.trim()}>
                <span>Copy &amp; open review page</span>
                <span className="rb-submit-arrow">{"\u2197"}</span>
              </button>
            ) : (
              <p className="rb-alert rb-alert-error" role="status">
                <span>!</span>
                This business hasn&apos;t set a review page yet. You can still copy your draft.
              </p>
            )}

            <div className="rb-step-actions">
              <button type="button" className="rb-copy-button" onClick={handleCopy} disabled={!text.trim()}>
                Copy text
              </button>
              <button
                type="button"
                className="rb-copy-button"
                onClick={() => requestDraft(true)}
                disabled={submitting}
              >
                {submitting ? "Rewriting..." : "Regenerate"}
              </button>
              <button type="button" className="rb-copy-button" onClick={() => go("feedback")}>
                {"\u2190"} Edit feedback
              </button>
            </div>
          </>
        )}

        {/* ---------------- Screen 4: Done ---------------- */}
        {step === "done" && (
          <>
            <div className="rb-intro">
              <span className="rb-kicker">ALMOST DONE</span>
              <h1 ref={headingRef} tabIndex={-1} className="rb-step-heading">
                Paste and post your review
              </h1>
              <p>
                {copied ? "Your draft is copied. " : "Your draft could not be copied automatically. "}
                {opened
                  ? "The review page opened in a new tab: paste the text there and press submit."
                  : "Open the review page below, paste the text and press submit."}{" "}
                Your review is only published once you submit it on that site.
              </p>
            </div>

            {!copied && (
              <div className="rb-fallback">
                <label htmlFor="rb-final">Your review text</label>
                <textarea id="rb-final" ref={draftRef} value={text} readOnly rows={5} onFocus={(e) => e.target.select()} />
              </div>
            )}

            {business.review_destination_url && (
              <a
                className="rb-submit"
                href={business.review_destination_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "none" }}
              >
                <span>{opened ? "Open review page again" : "Open review page"}</span>
                <span className="rb-submit-arrow">{"\u2197"}</span>
              </a>
            )}
            <div className="rb-step-actions">
              <button type="button" className="rb-copy-button" onClick={handleCopy}>
                {copied ? "Copy again" : "Try copying again"}
              </button>
              <button type="button" className="rb-copy-button" onClick={() => go("draft")}>
                {"\u2190"} Back to draft
              </button>
              <button type="button" className="rb-copy-button" onClick={startOver}>
                Start over
              </button>
            </div>
            <div className="rb-honesty">
              <span>*</span>
              Thank you for sharing honest feedback with {business.name}.
            </div>
          </>
        )}
      </section>

      <footer className="rb-footer">
        Made with care by <strong>ReviewBoost AI</strong>
      </footer>
    </main>
  );
}

export default function CustomerReviewPage() {
  return (
    <Suspense
      fallback={
        <main className="rb-page">
          <div className="rb-state">
            <span className="rb-brand-mark">*</span>
            <h1>Getting things ready</h1>
            <p>Just a moment...</p>
          </div>
        </main>
      }
    >
      <ReviewContent />
    </Suspense>
  );
}
