from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, field_validator, model_validator


def mongo_precision(value: datetime) -> datetime:
    # BSON dates retain milliseconds, so write responses must use the same precision.
    return value.astimezone(timezone.utc).replace(microsecond=(value.microsecond // 1000) * 1000)


def utcnow() -> datetime:
    return mongo_precision(datetime.now(timezone.utc))


def new_id() -> str:
    return str(uuid4())


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    @field_validator("*", mode="after")
    @classmethod
    def utc_dates(cls, value):
        if isinstance(value, datetime):
            if value.tzinfo is None or value.utcoffset() is None:
                raise ValueError("Dates must include a timezone")
            return mongo_precision(value)
        return value


Title = Annotated[str, StringConstraints(min_length=1, max_length=200)]
Text = Annotated[str, StringConstraints(max_length=20000)]
Priority = Literal["high", "medium", "low"]
Status = Literal["todo", "in_progress", "completed"]
ID = Annotated[str, StringConstraints(min_length=36, max_length=36)]


def check_id(value: str | None) -> str | None:
    if value is not None:
        return str(UUID(value))
    return None


class Register(Strict):
    name: Annotated[str, StringConstraints(min_length=1, max_length=100)]
    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=10, max_length=128)

    @field_validator("password", mode="before")
    @classmethod
    def preserve_password(cls, value):
        # Password whitespace is significant; other strings are trimmed.
        return value

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, value):
        if not value.strip():
            raise ValueError("Name must not be blank")
        return value.strip()


class Login(Strict):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=1, max_length=128)


class Forgot(Strict):
    email: EmailStr = Field(max_length=254)


class Reset(Strict):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    token: str = Field(min_length=20, max_length=200)
    password: str = Field(min_length=10, max_length=128)


class Profile(Strict):
    name: Annotated[str, StringConstraints(min_length=1, max_length=100)] | None = None
    timezone: str | None = Field(default=None, max_length=100)
    notifications_enabled: bool | None = None

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value):
        if value is not None:
            try:
                ZoneInfo(value)
            except ZoneInfoNotFoundError:
                raise ValueError("Unknown IANA timezone") from None
        return value

    @model_validator(mode="after")
    def no_null(self):
        if any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError("Profile fields cannot be null")
        return self


class Subtask(Strict):
    id: ID = Field(default_factory=new_id)
    title: Title
    completed: bool = False
    _id = field_validator("id")(check_id)


class TaskCreate(Strict):
    title: Title
    description: Text = ""
    category: Annotated[str, StringConstraints(min_length=1, max_length=100)] = "Personal"
    priority: Priority = "medium"
    status: Status = "todo"
    start_at: datetime | None = None
    due_at: datetime | None = None
    estimated_minutes: int = Field(default=30, ge=0, le=525600, strict=True)
    actual_minutes: int = Field(default=0, ge=0, le=525600, strict=True)
    subtasks: list[Subtask] = Field(default_factory=list, max_length=100)
    tags: list[Annotated[str, StringConstraints(min_length=1, max_length=50)]] = Field(default_factory=list, max_length=30)
    project_id: ID | None = None
    reminder_minutes: int | None = Field(default=None, ge=0, le=525600, strict=True)
    _project = field_validator("project_id")(check_id)

    @model_validator(mode="after")
    def consistency(self):
        if self.start_at and self.due_at and self.start_at > self.due_at:
            raise ValueError("due_at must not precede start_at")
        ids = [item.id for item in self.subtasks]
        if len(ids) != len(set(ids)):
            raise ValueError("Subtask IDs must be unique")
        return self


class TaskPatch(Strict):
    title: Title | None = None
    description: Text | None = None
    category: Annotated[str, StringConstraints(min_length=1, max_length=100)] | None = None
    priority: Priority | None = None
    status: Status | None = None
    start_at: datetime | None = None
    due_at: datetime | None = None
    estimated_minutes: int | None = Field(default=None, ge=0, le=525600, strict=True)
    actual_minutes: int | None = Field(default=None, ge=0, le=525600, strict=True)
    subtasks: list[Subtask] | None = Field(default=None, max_length=100)
    tags: list[Annotated[str, StringConstraints(min_length=1, max_length=50)]] | None = Field(default=None, max_length=30)
    project_id: ID | None = None
    reminder_minutes: int | None = Field(default=None, ge=0, le=525600, strict=True)
    _project = field_validator("project_id")(check_id)

    @model_validator(mode="after")
    def no_null(self):
        nullable = {"start_at", "due_at", "project_id", "reminder_minutes"}
        if any(getattr(self, key) is None for key in self.model_fields_set - nullable):
            raise ValueError("Only dates, project_id and reminder_minutes may be null")
        return self


class ProjectCreate(Strict):
    name: Title
    description: Text = ""
    start_at: datetime | None = None
    deadline: datetime | None = None
    status: Literal["active", "on_hold", "completed"] = "active"
    priority: Priority = "medium"

    @model_validator(mode="after")
    def dates(self):
        if self.start_at and self.deadline and self.start_at > self.deadline:
            raise ValueError("deadline must not precede start_at")
        return self


class ProjectPatch(Strict):
    name: Title | None = None
    description: Text | None = None
    start_at: datetime | None = None
    deadline: datetime | None = None
    status: Literal["active", "on_hold", "completed"] | None = None
    priority: Priority | None = None

    @model_validator(mode="after")
    def no_null(self):
        if any(getattr(self, key) is None for key in self.model_fields_set - {"start_at", "deadline"}):
            raise ValueError("Only dates may be null")
        return self


class NoteCreate(Strict):
    title: Title
    content: Text = ""


class NotePatch(Strict):
    title: Title | None = None
    content: Text | None = None

    @model_validator(mode="after")
    def no_null(self):
        if any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError("Note fields cannot be null")
        return self


class SchedulePatch(Strict):
    start_at: datetime
    end_at: datetime

    @model_validator(mode="after")
    def interval(self):
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        if (self.end_at - self.start_at).total_seconds() > 7 * 86400:
            raise ValueError("A schedule may not exceed seven days")
        return self


class ScheduleCreate(SchedulePatch):
    task_id: ID
    _task = field_validator("task_id")(check_id)


class NotificationPatch(Strict):
    read: bool


class Chat(Strict):
    message: Annotated[str, StringConstraints(min_length=1, max_length=4000)]


class CreateTaskAction(Strict):
    type: Literal["create_task"]
    task: TaskCreate


class ScheduleTaskAction(ScheduleCreate):
    type: Literal["schedule_task"]


Action = Annotated[CreateTaskAction | ScheduleTaskAction, Field(discriminator="type")]


class LLMResult(Strict):
    reply: Annotated[str, StringConstraints(min_length=1, max_length=6000)]
    summary: Annotated[str, StringConstraints(max_length=500)] = ""
    actions: list[Action] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def summary_required(self):
        if self.actions and not self.summary:
            raise ValueError("Actions require a summary")
        return self
