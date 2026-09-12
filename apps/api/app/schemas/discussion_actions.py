"""Shared discussion affordances; mutations must still recheck authorization."""

from pydantic import BaseModel


class DiscussionActions(BaseModel):
    edit: bool = False
    change_status: bool = False
    delete: bool = False
    reply: bool = False
