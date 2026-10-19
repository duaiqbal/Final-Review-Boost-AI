"""
Guardrails for the AI review feature.

Layer 1 (input):  validate answers against the business config, clean the comment,
                  remove contact details, drop prompt-injection attempts.
Layer 2 (output): check the AI text against the customer's real facts
                  (no invented details, sentiment must match ratings).
Layer 3 (fallback): if AI keeps failing, build a safe draft with NO AI.
"""
import re
from dataclasses import dataclass, field


class GuardrailError(Exception):
    def __init__(self, message: str, missing=None):
        super().__init__(message)
        self.message = message
        self.missing = missing or []


@dataclass
class RatedItem:
    category: str
    description: str
    rating: str
    score: int
    sentiment: str  # positive | mixed | negative


@dataclass
class ReviewContext:
    business_name: str
    business_type: str
    items: list = field(default_factory=list)
    comment: str = ""


# ------------------------------------------------------------------ patterns
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
TAG_RE = re.compile(r"<[^>]{0,200}>")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
URL_RE = re.compile(r"(?:https?://|www\.)\S+", re.I)
PHONE_RE = re.compile(r"(?<!\w)\+?\d[\d\s\-().]{7,}\d(?!\w)")
NUM_RE = re.compile(r"\d+(?:[.,]\d+)*")
WORD_RE = re.compile(r"[A-Za-z][A-Za-z'\u2019-]*")

INJECTION_PATTERNS = [
    r"ignore\s+(all\s+|any\s+|the\s+|your\s+)?(previous|above|prior|earlier)",
    r"disregard\s+(all\s+|any\s+|the\s+|your\s+)?(previous|above|prior|earlier|instructions)",
    r"forget\s+(all\s+|your\s+)?(previous|prior|instructions|rules)",
    r"(reveal|show|print|repeat)\s+(me\s+)?(your|the)\s+(system\s+)?(prompt|instructions|rules)",
    r"\bsystem\s+prompt\b",
    r"\byou\s+are\s+now\b",
    r"\bpretend\s+(to\s+be|you\s+are)\b",
    r"\bact\s+as\s+(a|an|if\s+you)\b",
    r"\bdeveloper\s+mode\b|\bjailbreak\b|\bDAN\s+mode\b",
    r"</?\s*(system|assistant|user)\s*>",
    r"\bnew\s+instructions?\b",
    r"write\s+(a\s+)?(5|five)[- ]star",
]
INJECTION_RE = [re.compile(p, re.I) for p in INJECTION_PATTERNS]

# Details an AI likes to invent. Flagged unless the customer/category itself used the word.
INVENTED_WORDS = {
    "waiter", "waitress", "server", "chef", "cook", "manager", "owner", "receptionist",
    "stylist", "barber", "doctor", "nurse", "cashier", "bartender", "barista",
    "price", "prices", "priced", "pricing", "cheap", "expensive", "affordable",
    "discount", "coupon", "parking",
    "recommend", "recommended", "recommending",
    "yesterday", "tonight", "birthday", "anniversary", "weekend",
    "breakfast", "lunch", "dinner",
    "friends", "family", "kids", "wife", "husband", "girlfriend", "boyfriend",
}
INVENTED_PHRASES = [
    re.compile(p, re.I)
    for p in [
        r"\b(come|coming|be|go|going) back\b",
        r"\bnext time\b",
        r"\b(visit|return|go|come) again\b",
        r"\bwill return\b",
    ]
]
STRONG_POSITIVE = {
    "amazing", "fantastic", "perfect", "wonderful", "outstanding", "exceptional",
    "excellent", "great", "love", "loved", "delicious", "flawless", "superb",
    "incredible", "awesome", "best", "delightful", "impressed", "impressive",
}
NEGATIVE_WORDS = {
    "disappointing", "disappointed", "poor", "poorly", "bad", "terrible", "awful",
    "worst", "unfortunately", "lacking", "subpar", "mediocre", "unpleasant",
    "horrible", "improvement", "improve",
}
META_RE = re.compile(r"\b(as an ai|language model|json|prompt|draft)\b", re.I)
EMOJI_RE = re.compile(r"[#@\U0001F300-\U0001FAFF\u2600-\u27BF]")
FIRST_PERSON_RE = re.compile(r"\b(I|I'm|I've|My|my|me|we|We|our|Our)\b")


# ------------------------------------------------------------------ helpers
def _words(text: str) -> set:
    return {w.lower() for w in WORD_RE.findall(text or "")}


def classify(score: int, lo: int, hi: int) -> str:
    if hi == lo:
        return "mixed"
    n = (score - lo) / (hi - lo)
    if n < 0.30:
        return "negative"
    if n >= 0.66:
        return "positive"
    return "mixed"


def _join(names: list) -> str:
    if len(names) == 1:
        return names[0]
    return ", ".join(names[:-1]) + " and " + names[-1]


# ------------------------------------------------------------------ INPUT
def sanitize_comment(raw: str):
    """Returns (clean_comment, warnings). Never raises: bad comments are dropped."""
    warnings = []
    text = CONTROL_RE.sub(" ", raw or "")
    text = TAG_RE.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return "", warnings
    if any(p.search(text) for p in INJECTION_RE):
        return "", ["Your comment looked like instructions to the AI, so it was left out of the draft."]
    stripped = PHONE_RE.sub("", URL_RE.sub("", EMAIL_RE.sub("", text)))
    if stripped != text:
        warnings.append("Links and contact details were removed from your comment.")
    text = re.sub(r"\s+", " ", stripped).strip()
    return text[:500], warnings


def validate_answers(business: dict, answers: list, comment: str) -> list:
    """Check answers against THIS business's own config. Returns RatedItem list."""
    cats = {c["id"]: c for c in business["categories"]}
    ratings = {r["label"].lower(): r for r in business["rating_options"]}
    scores = [r["score"] for r in business["rating_options"]]
    lo, hi = min(scores), max(scores)

    chosen = {}
    for a in answers:
        if a.category_id not in cats:
            raise GuardrailError("One of the questions does not belong to this business.")
        if a.category_id in chosen:
            raise GuardrailError("A question was answered twice.")
        opt = ratings.get(a.rating.strip().lower())
        if opt is None:
            raise GuardrailError(f"'{a.rating}' is not a valid rating option.")
        chosen[a.category_id] = opt

    missing = [c["name"] for c in business["categories"] if c["required"] and c["id"] not in chosen]
    if missing:
        raise GuardrailError("Please answer: " + ", ".join(missing), missing=missing)
    if not chosen and not comment:
        raise GuardrailError("Please answer at least one question or write a comment.")

    items = []
    for c in business["categories"]:  # keep admin's order
        if c["id"] in chosen:
            opt = chosen[c["id"]]
            items.append(
                RatedItem(c["name"], c.get("description", ""), opt["label"], opt["score"],
                          classify(opt["score"], lo, hi))
            )
    return items


# ------------------------------------------------------------------ OUTPUT
def check_review(review: str, ctx: ReviewContext) -> list:
    """Returns a list of problems. Empty list == safe to show."""
    problems = []
    text = (review or "").strip()
    if len(text) < 20:
        return ["Review is empty or too short."]
    if len(text) > 600 or len(text.split()) > 110:
        problems.append("Too long (keep it to 2-4 short sentences).")
    if URL_RE.search(text) or EMAIL_RE.search(text) or PHONE_RE.search(text):
        problems.append("Contains a link, email or phone number.")
    if EMOJI_RE.search(text):
        problems.append("Contains emoji, hashtags or @mentions.")
    if META_RE.search(text):
        problems.append("Mentions AI/prompt/draft instead of being a plain review.")
    if not FIRST_PERSON_RE.search(text):
        problems.append("Must be written in first person.")

    allowed_text = " ".join(
        [ctx.business_name, ctx.business_type, ctx.comment]
        + [f"{i.category} {i.description} {i.rating}" for i in ctx.items]
    )
    allowed = _words(allowed_text)
    out_words = _words(text)
    comment_words = _words(ctx.comment)

    extra_numbers = set(NUM_RE.findall(text)) - set(NUM_RE.findall(allowed_text))
    if extra_numbers:
        problems.append("Contains numbers the customer never gave: " + ", ".join(sorted(extra_numbers)))

    invented = (out_words & INVENTED_WORDS) - allowed
    if invented:
        problems.append("Invented details not given by the customer: " + ", ".join(sorted(invented)))
    for pat in INVENTED_PHRASES:
        if pat.search(text) and not pat.search(ctx.comment):
            problems.append("Invented intent (e.g. coming back / next time).")
            break

    bad_names = []
    for sentence in re.split(r"(?<=[.!?])\s+", text):
        tokens = WORD_RE.findall(sentence)
        for i, tok in enumerate(tokens):
            if i == 0 or not tok[0].isupper():
                continue
            if tok == "I" or tok.startswith("I'") or tok.startswith("I\u2019"):
                continue
            if tok.lower() not in allowed:
                bad_names.append(tok)
    if bad_names:
        problems.append("Contains names/words not supplied by the customer: " + ", ".join(sorted(set(bad_names))))

    sentiments = {i.sentiment for i in ctx.items}
    if sentiments and "positive" not in sentiments:
        too_happy = (out_words & STRONG_POSITIVE) - comment_words
        if too_happy:
            problems.append("Too positive for the ratings given: " + ", ".join(sorted(too_happy)))
    if sentiments and sentiments == {"positive"}:
        too_sad = (out_words & NEGATIVE_WORDS) - comment_words
        if too_sad:
            problems.append("Too negative for the ratings given: " + ", ".join(sorted(too_sad)))

    lowered = text.lower()
    for i in ctx.items:
        if i.sentiment == "negative":
            keys = [w for w in _words(i.category) if len(w) > 3] or list(_words(i.category))
            if i.category.lower() not in lowered and not any(k in out_words for k in keys):
                problems.append(f"Left out the low rating for '{i.category}'. Negative feedback must be kept.")
    return problems


# ------------------------------------------------------------------ FALLBACK
def build_fallback_review(ctx: ReviewContext) -> str:
    """Safe, plain draft built from the ratings only. No AI involved."""
    parts = [f"I visited {ctx.business_name}."]
    groups = {}
    for it in sorted(ctx.items, key=lambda x: -x.score):
        groups.setdefault(it.rating, []).append(it.category)
    for label, names in groups.items():
        parts.append(f'My rating for {_join(names)} was "{label}".')
    if ctx.comment:
        c = ctx.comment
        parts.append(c if c[-1] in ".!?" else c + ".")
    return " ".join(parts)
