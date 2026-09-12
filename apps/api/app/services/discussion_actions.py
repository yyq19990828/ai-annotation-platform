"""Pure policy shared by discussion reads and writes.

Callers establish task visibility, active ancestry and quality-anchor validity
before projecting these capabilities. Project authorization is not inferred here.
"""

from typing import Literal

from app.schemas.discussion_actions import DiscussionActions


def discussion_actions(
    source: Literal["annotation_comment", "feedback"],
    kind: str,
    *,
    is_author: bool,
    is_admin: bool,
    is_reviewer: bool,
    is_accessible: bool,
    can_reply: bool,
) -> DiscussionActions:
    if not is_accessible:
        return DiscussionActions()
    owns_content = is_author or is_admin
    is_issue = source == "feedback" and kind == "issue"
    return DiscussionActions(
        edit=owns_content,
        change_status=owns_content or (is_issue and is_reviewer),
        delete=owns_content,
        reply=is_issue and can_reply,
    )
