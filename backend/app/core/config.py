from functools import lru_cache

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    mongo_uri: str = "mongodb://localhost:27017/?replicaSet=rs0"
    mongo_database: str = "kazi"
    frontend_origin: str = "http://localhost:3000"
    cookie_name: str = "kazi_session"
    cookie_secure: bool = False
    session_hours: int = Field(default=168, ge=1, le=720)
    reset_minutes: int = Field(default=30, ge=5, le=60)
    auth_rate_limit: int = Field(default=10, ge=1, le=100)
    auth_rate_window_seconds: int = Field(default=900, ge=1)
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from: str = "noreply@localhost"
    smtp_starttls: bool = True
    openai_api_key: str | None = None
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"
    ai_timeout_seconds: int = Field(default=45, ge=1, le=120)
    ai_rate_limit: int = Field(default=20, ge=1, le=200)

    @model_validator(mode="after")
    def deployment_safety(self):
        from urllib.parse import urlsplit

        origin = urlsplit(self.frontend_origin)
        if origin.scheme not in {"http", "https"} or not origin.netloc or origin.path or origin.query or origin.fragment:
            raise ValueError("FRONTEND_ORIGIN must be an exact origin without trailing slash")
        if self.environment == "production" and (not self.cookie_secure or origin.scheme != "https"):
            raise ValueError("Production requires COOKIE_SECURE=true and an HTTPS FRONTEND_ORIGIN")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
