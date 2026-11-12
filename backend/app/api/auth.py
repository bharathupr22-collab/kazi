import secrets
import smtplib
import ssl
from datetime import timedelta
from email.message import EmailMessage
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pymongo.errors import DuplicateKeyError

from app.core.security import DUMMY_HASH, auth_limit, current_user, digest, hasher, issue_session, public_user, verify_password
from app.db.mongo import get_db, session_kw, transaction
from app.schemas.entities import Forgot, Login, Profile, Register, Reset, new_id, utcnow

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", status_code=201, dependencies=[Depends(auth_limit)])
def register(body: Register, request: Request, response: Response, db=Depends(get_db)):
    user = {"id": new_id(), "name": body.name, "email": str(body.email).lower(), "password_hash": hasher.hash(body.password),
            "timezone": "UTC", "notifications_enabled": True, "created_at": utcnow(), "auth_version": 0, "write_revision": 0}
    try:
        db.users.insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(409, "An account with this email already exists") from None
    issue_session(request, response, db, user)
    return public_user(user)


@router.post("/login", dependencies=[Depends(auth_limit)])
def login(body: Login, request: Request, response: Response, db=Depends(get_db)):
    user = db.users.find_one({"email": str(body.email).lower()})
    valid = verify_password(user["password_hash"] if user else DUMMY_HASH, body.password)
    if not user or not valid:
        raise HTTPException(401, "Invalid email or password")
    if hasher.check_needs_rehash(user["password_hash"]):
        # A concurrent reset must not be overwritten by a rehash of the old password.
        result = db.users.update_one({
            "id": user["id"], "password_hash": user["password_hash"],
            "auth_version": user.get("auth_version", 0),
        }, {"$set": {"password_hash": hasher.hash(body.password)}})
        if not result.matched_count:
            raise HTTPException(401, "Credentials changed; please log in again")
    issue_session(request, response, db, user)
    return public_user(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db=Depends(get_db)):
    settings = request.app.state.settings
    token = request.cookies.get(settings.cookie_name)
    if token:
        db.sessions.delete_one({"token_hash": digest(token)})
    response.delete_cookie(settings.cookie_name, path="/", secure=settings.cookie_secure, httponly=True, samesite="lax")
    response.status_code = 204


@router.get("/me")
def me(user=Depends(current_user)):
    return public_user(user)


@router.patch("/me")
def profile(body: Profile, user=Depends(current_user), db=Depends(get_db)):
    changes = body.model_dump(exclude_unset=True)
    if changes:
        db.users.update_one({"id": user["id"]}, {"$set": changes})
    return public_user(db.users.find_one({"id": user["id"]}))


def send_reset(settings, email, token):
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = email
    message["Subject"] = "Reset your Kazi password"
    link = settings.frontend_origin + "/reset-password?" + urlencode({"token": token})
    message.set_content(f"Reset your password using this link (expires in {settings.reset_minutes} minutes):\n\n{link}\n\nIf you did not request this, ignore this email.")
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        if settings.smtp_starttls:
            smtp.starttls(context=ssl.create_default_context())
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password or "")
        smtp.send_message(message)


@router.post("/forgot-password", dependencies=[Depends(auth_limit)])
def forgot(body: Forgot, request: Request, db=Depends(get_db)):
    settings = request.app.state.settings
    if not settings.smtp_host:
        raise HTTPException(503, "Password reset email is unavailable. Ask the administrator to configure SMTP.")
    email = str(body.email).lower()
    user = db.users.find_one({"email": email})
    # Send even for unknown addresses to avoid account-existence timing differences.
    # Such tokens have no stored credential and cannot reset any account.
    token = secrets.token_urlsafe(48)
    token_hash = digest(token)
    if user:
        db.password_resets.update_one({"user_id": user["id"]}, {"$set": {
            "token_hash": token_hash, "expires_at": utcnow() + timedelta(minutes=settings.reset_minutes),
            "auth_version": user.get("auth_version", 0),
        }}, upsert=True)
    try:
        send_reset(settings, email, token)
    except (OSError, smtplib.SMTPException):
        db.password_resets.delete_one({"token_hash": token_hash})
        raise HTTPException(503, "Password reset email could not be sent. Try again later.") from None
    return {"message": "If an account exists for that email, password reset instructions have been sent."}


@router.post("/reset-password", dependencies=[Depends(auth_limit)])
def reset(body: Reset, request: Request, db=Depends(get_db)):
    hashed_password = hasher.hash(body.password)
    with transaction(request) as session:
        kw = session_kw(session)
        record = db.password_resets.find_one({"token_hash": digest(body.token), "expires_at": {"$gt": utcnow()}}, **kw)
        if not record:
            raise HTTPException(400, "Invalid or expired reset token")
        result = db.users.update_one({"id": record["user_id"], "auth_version": record.get("auth_version", 0)}, {
            "$set": {"password_hash": hashed_password}, "$inc": {"auth_version": 1},
        }, **kw)
        if not result.modified_count:
            raise HTTPException(400, "Invalid or expired reset token")
        db.sessions.delete_many({"user_id": record["user_id"]}, **kw)
        db.password_resets.delete_many({"user_id": record["user_id"]}, **kw)
    return {"message": "Password reset successful. Please log in."}
