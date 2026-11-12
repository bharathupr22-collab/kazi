import logging
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo.errors import OperationFailure, PyMongoError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import auth, insights, resources
from app.core.config import Settings, get_settings
from app.core.security import RateLimiter
from app.db.mongo import connect, indexes

logger = logging.getLogger("kazi.api")


class BodyLimitMiddleware:
    """Bound request memory before JSON decoding, including chunked uploads."""
    def __init__(self, app, limit=262144):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope["method"] in {"GET", "HEAD", "OPTIONS"}:
            return await self.app(scope, receive, send)
        body = bytearray()
        while True:
            event = await receive()
            if event["type"] == "http.disconnect":
                return
            body.extend(event.get("body", b""))
            if len(body) > self.limit:
                return await JSONResponse({"detail": "Request body exceeds 256 KiB"}, status_code=413)(scope, receive, send)
            if not event.get("more_body", False):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


def create_app(settings: Settings | None = None, database=None, transaction_factory=None):
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app):
        if database is None:
            client, db = connect(settings)
            app.state.mongo_client = client
            app.state.db = db
        else:
            app.state.mongo_client = None
            app.state.db = database
        # Mongo setup is synchronous but only runs once before serving requests.
        indexes(app.state.db)
        try:
            yield
        finally:
            if app.state.mongo_client is not None:
                app.state.mongo_client.close()

    app = FastAPI(title="Kazi API", version="0.1.0", lifespan=lifespan,
                  docs_url="/api/docs" if settings.environment != "production" else None,
                  redoc_url=None, openapi_url="/api/openapi.json" if settings.environment != "production" else None)
    app.state.settings = settings
    app.state.limiter = RateLimiter()
    app.state.transaction_factory = transaction_factory
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=[settings.frontend_origin], allow_credentials=True,
                       allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"], allow_headers=["Content-Type"])

    @app.middleware("http")
    async def security_headers_and_origin(request: Request, call_next):
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            if not origin:
                referer = request.headers.get("referer", "")
                try:
                    parts = urlsplit(referer)
                    origin = f"{parts.scheme}://{parts.netloc}" if parts.scheme and parts.netloc else None
                except ValueError:
                    origin = None
            # Also protect login/register: login CSRF can bind victims to an attacker's account.
            if origin != settings.frontend_origin or request.headers.get("sec-fetch-site") == "cross-site":
                return JSONResponse({"detail": "CSRF origin check failed. Send requests from the configured frontend origin."}, status_code=403,
                                                    headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"})
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Do not reflect input (especially credentials) or structured error arrays.
        details = [f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}" for error in exc.errors()]
        return JSONResponse({"detail": "; ".join(details)}, status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request, exc):
        return JSONResponse({"detail": str(exc.detail)}, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(PyMongoError)
    async def database_error(request, exc):
        logger.warning("Database failure method=%s path=%s type=%s", request.method, request.url.path, type(exc).__name__)
        if isinstance(exc, OperationFailure) and exc.has_error_label("TransientTransactionError"):
            return JSONResponse({"detail": "A concurrent update occurred. Retry the operation; proposal confirmation is idempotent."}, status_code=409)
        return JSONResponse({"detail": "Database temporarily unavailable; please retry. Proposal confirmation is safe to retry."}, status_code=503)

    @app.exception_handler(Exception)
    async def unexpected_error(request, exc):
        # Do not log exception bodies: provider/database errors can contain credentials.
        logger.error("Unhandled failure method=%s path=%s type=%s", request.method, request.url.path, type(exc).__name__)
        return JSONResponse({"detail": "An unexpected server error occurred. Please retry or contact the administrator."}, status_code=500,
                            headers={"Cache-Control": "no-store"})

    @app.get("/api/health", tags=["health"])
    @app.get("/health", include_in_schema=False)
    def health():
        try:
            app.state.db.command("ping")
        except PyMongoError:
            return JSONResponse({"detail": "Database unavailable"}, status_code=503)
        return {"status": "ok", "database": "connected", "ai_configured": bool(settings.openai_api_key)}

    for router in (auth.router, resources.router, insights.router):
        app.include_router(router, prefix="/api")
    return app


app = create_app()
