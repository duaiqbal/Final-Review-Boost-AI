"""Hypothesis strategies for valid admin input and review contexts."""
from hypothesis import strategies as st

_chars = st.characters(blacklist_categories=("Cc", "Cs"))


def stripped_text(min_size, max_size):
    return st.text(_chars, min_size=min_size, max_size=max_size).filter(
        lambda s: s == s.strip() and (min_size == 0 or s))


categories = st.lists(
    st.fixed_dictionaries({
        "name": stripped_text(1, 60),
        "description": stripped_text(0, 200),
        "required": st.booleans(),
    }),
    min_size=1, max_size=12, unique_by=lambda c: c["name"].lower(),
)

rating_options = st.lists(
    st.fixed_dictionaries({"label": stripped_text(1, 30), "score": st.integers(1, 5)}),
    min_size=2, max_size=6, unique_by=lambda r: r["label"].lower(),
)

business_input = st.fixed_dictionaries({
    "name": stripped_text(1, 80),
    "business_type": stripped_text(1, 40),
    "logo_url": st.sampled_from([None, "https://example.com/logo.png"]),
    "brand_color": st.from_regex(r"\A#[0-9a-fA-F]{6}\Z"),
    "welcome_message": stripped_text(0, 300),
    "status": st.sampled_from(["active", "inactive"]),
    "review_destination_url": st.sampled_from([None, "https://maps.google.com/x", "http://example.org/r?a=1"]),
    "categories": categories,
    "rating_options": rating_options,
})

plain_word = st.from_regex(r"\A[a-z]{3,9}\Z")
