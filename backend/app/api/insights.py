from fastapi import APIRouter, Depends, Request

from app.core.security import current_user
from app.db.mongo import get_db
from app.schemas.entities import Chat
from app.services.analytics import build_analytics
from app.services.assistant import confirm, make_proposal
from app.services.entities import owned

router = APIRouter(tags=["insights"])


@router.get("/analytics")
def analytics(user=Depends(current_user), db=Depends(get_db)):
    return build_analytics(db, user)


@router.post("/assistant/chat")
def chat(body: Chat, request: Request, user=Depends(current_user), db=Depends(get_db)):
    return make_proposal(request, db, user, body.message)


@router.post("/assistant/proposals/{proposal_id}/confirm")
def confirm_proposal(proposal_id: str, request: Request, user=Depends(current_user), db=Depends(get_db)):
    return confirm(request, db, user, proposal_id)


@router.post("/notes/{note_id}/convert")
def convert_note(note_id: str, request: Request, user=Depends(current_user), db=Depends(get_db)):
    note = owned(db, "notes", user["id"], note_id)
    return make_proposal(request, db, user, "Convert this note into actionable tasks. Propose only; do not save yet.", note=note)
