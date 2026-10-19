import os
from dotenv import load_dotenv

load_dotenv()


def _clean_secret(value: str) -> str:
    """Tolerate common paste mistakes: whitespace, surrounding quotes, or a 'NAME=' prefix."""
    value = (value or "").strip()
    if value.upper().startswith("GEMINI_API_KEY="):
        value = value.split("=", 1)[1].strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1].strip()
    return value


class Settings:
    GEMINI_API_KEY: str = _clean_secret(os.getenv("GEMINI_API_KEY", ""))
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "")
    JWT_SECRET: str = os.getenv("JWT_SECRET", "")
    FRONTEND_BASE_URL: str = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000").rstrip("/")
    ALLOWED_ORIGINS: list = [
        o.strip().rstrip("/")
        for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
        if o.strip()
    ]
    DATABASE_PATH: str = os.getenv("DATABASE_PATH", "reviewboost.db")
    TOKEN_HOURS: int = 12
    AI_TIMEOUT_MS: int = 15000
    AI_MAX_ATTEMPTS: int = 3


settings = Settings()
