import re
from typing import Literal, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, Field, field_validator, model_validator

from .templates import DEFAULT_RATING_OPTIONS

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
ID_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"


def clean(value: str) -> str:
    return CONTROL_CHARS.sub("", value).strip()


def safe_http_url(value: Optional[str]) -> Optional[str]:
    """Only http/https links are accepted (blocks javascript:, data:, file: ...)."""
    if value is None:
        return None
    value = value.strip()
    if value == "":
        return None
    if len(value) > 2048 or re.search(r"\s", value):
        raise ValueError("URL is invalid or too long")
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("URL must start with http:// or https://")
    return value


# ---------------- Admin input ----------------
class CategoryIn(BaseModel):
    id: Optional[str] = Field(default=None, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    name: str = Field(min_length=1, max_length=60)
    description: str = Field(default="", max_length=200)
    required: bool = True

    @field_validator("name", "description")
    @classmethod
    def _clean(cls, v):
        return clean(v)


class RatingOptionIn(BaseModel):
    label: str = Field(min_length=1, max_length=30)
    score: int = Field(ge=1, le=5)  # higher = happier

    @field_validator("label")
    @classmethod
    def _clean(cls, v):
        return clean(v)


class BusinessIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    business_type: str = Field(default="Business", min_length=1, max_length=40)
    logo_url: Optional[str] = None
    brand_color: str = "#4F46E5"
    welcome_message: str = Field(
        default="We'd love to hear about your experience. It only takes a minute.",
        max_length=300,
    )
    status: Literal["active", "inactive"] = "active"
    review_destination_url: Optional[str] = None
    categories: list[CategoryIn] = Field(min_length=1, max_length=12)
    rating_options: list[RatingOptionIn] = Field(
        default_factory=lambda: [RatingOptionIn(**r) for r in DEFAULT_RATING_OPTIONS],
        min_length=2,
        max_length=6,
    )

    @field_validator("name", "business_type", "welcome_message")
    @classmethod
    def _clean(cls, v):
        return clean(v)

    @field_validator("logo_url", "review_destination_url")
    @classmethod
    def _url(cls, v):
        return safe_http_url(v)

    @field_validator("brand_color")
    @classmethod
    def _color(cls, v):
        if not HEX_COLOR.match(v):
            raise ValueError("brand_color must look like #4F46E5")
        return v

    @model_validator(mode="after")
    def _unique(self):
        names = [c.name.lower() for c in self.categories]
        if len(set(names)) != len(names):
            raise ValueError("Category names must be unique")
        labels = [r.label.lower() for r in self.rating_options]
        if len(set(labels)) != len(labels):
            raise ValueError("Rating labels must be unique")
        return self


class StatusIn(BaseModel):
    status: Literal["active", "inactive"]


class LoginIn(BaseModel):
    password: str = Field(min_length=1, max_length=200)


# ---------------- Customer input ----------------
class AnswerIn(BaseModel):
    category_id: str = Field(max_length=40)
    rating: str = Field(max_length=30)


class GenerateReviewIn(BaseModel):
    answers: list[AnswerIn] = Field(default_factory=list, max_length=12)
    comment: str = Field(default="", max_length=600)
    regenerate: bool = False


class EventIn(BaseModel):
    event: Literal["copy_and_open_clicked"]
