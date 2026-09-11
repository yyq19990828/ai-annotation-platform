"""The UI and routers share the same field-level capability contract."""

import pytest

from app.services.discussion_actions import discussion_actions


@pytest.mark.parametrize(
    "source,kind", [("annotation_comment", "comment"), ("feedback", "issue")]
)
def test_inaccessible_has_no_actions(source, kind):
    result = discussion_actions(
        source,
        kind,
        is_author=True,
        is_admin=True,
        is_reviewer=True,
        is_accessible=False,
        can_reply=True,
    )
    assert not any(result.model_dump().values())


def test_reviewer_may_change_issue_status_but_not_content():
    assert discussion_actions(
        "feedback",
        "issue",
        is_author=False,
        is_admin=False,
        is_reviewer=True,
        is_accessible=True,
        can_reply=True,
    ).model_dump() == {
        "edit": False,
        "change_status": True,
        "delete": False,
        "reply": True,
    }


@pytest.mark.parametrize("source", ["annotation_comment", "feedback"])
def test_comments_have_no_issue_reply_or_reviewer_status(source):
    result = discussion_actions(
        source,
        "comment",
        is_author=False,
        is_admin=False,
        is_reviewer=True,
        is_accessible=True,
        can_reply=True,
    )
    assert not any(result.model_dump().values())


@pytest.mark.parametrize("author,admin", [(True, False), (False, True)])
def test_author_or_authorized_admin_controls_content(author, admin):
    result = discussion_actions(
        "annotation_comment",
        "comment",
        is_author=author,
        is_admin=admin,
        is_reviewer=False,
        is_accessible=True,
        can_reply=True,
    )
    assert result.edit and result.delete and result.change_status
    assert not result.reply
