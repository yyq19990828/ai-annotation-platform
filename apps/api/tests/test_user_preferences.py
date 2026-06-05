from pydantic import ValidationError

from app.schemas.user import UserPreferences


def test_workbench_layout_preferences_accept_camelcase_and_dump_aliases():
    prefs = UserPreferences.model_validate(
        {
            "workbench": {
                "smoothImage": False,
                "layout": {
                    "leftOpen": False,
                    "rightOpen": True,
                    "leftWidth": 320,
                    "rightWidth": 420,
                    "floatingTaskQueue": {
                        "detached": True,
                        "x": 24,
                        "y": 72,
                        "w": 320,
                        "h": 620,
                    },
                    "floatingClassPalette": {
                        "detached": True,
                        "x": 24,
                        "y": 420,
                        "w": 300,
                        "h": 420,
                    },
                    "floatingInspector": {
                        "detached": True,
                        "x": 640,
                        "y": 80,
                        "w": 360,
                        "h": 600,
                    },
                    "floatingDiscussion": {
                        "detached": True,
                        "x": 760,
                        "y": 180,
                        "w": 420,
                        "h": 560,
                    },
                    "triViewFloat": {
                        "collapsed": True,
                        "x": 720,
                        "y": 120,
                        "w": 300,
                        "h": 500,
                    },
                },
            }
        }
    )

    layout = prefs.workbench.layout
    assert layout.left_open is False
    assert layout.right_open is True
    assert layout.left_width == 320
    assert layout.right_width == 420
    assert layout.floating_task_queue is not None
    assert layout.floating_task_queue.detached is True
    assert layout.floating_class_palette is not None
    assert layout.floating_class_palette.w == 300
    assert layout.floating_inspector is not None
    assert layout.floating_inspector.detached is True
    assert layout.floating_discussion is not None
    assert layout.floating_discussion.h == 560
    assert layout.tri_view_float is not None
    assert layout.tri_view_float.collapsed is True

    dumped = prefs.model_dump(mode="json", exclude_unset=True, by_alias=True)
    assert dumped["workbench"]["smoothImage"] is False
    assert dumped["workbench"]["layout"]["leftOpen"] is False
    assert dumped["workbench"]["layout"]["floatingTaskQueue"]["detached"] is True
    assert dumped["workbench"]["layout"]["floatingClassPalette"]["w"] == 300
    assert dumped["workbench"]["layout"]["floatingInspector"]["w"] == 360
    assert dumped["workbench"]["layout"]["floatingDiscussion"]["h"] == 560
    assert dumped["workbench"]["layout"]["triViewFloat"]["h"] == 500


def test_workbench_layout_preferences_keep_default_subtree():
    prefs = UserPreferences.model_validate({})

    assert prefs.workbench.smoothImage is True
    assert prefs.workbench.layout.left_open is None
    assert prefs.workbench.layout.floating_task_queue is None
    assert prefs.workbench.layout.floating_class_palette is None
    assert prefs.workbench.layout.floating_inspector is None
    assert prefs.workbench.layout.floating_discussion is None


def test_preferences_top_level_merge_contract_keeps_other_subtrees():
    existing = {
        "workbench": {"smoothImage": True},
        "ai": {"params_by_backend": {"sam": {"score_threshold": 0.7}}},
    }
    incoming = UserPreferences.model_validate(
        {
            "workbench": {
                "smoothImage": False,
                "layout": {"rightWidth": 420},
            }
        }
    ).model_dump(mode="json", exclude_unset=True, by_alias=True)

    merged = {**existing, **incoming}

    assert merged["ai"] == existing["ai"]
    assert merged["workbench"]["smoothImage"] is False
    assert merged["workbench"]["layout"]["rightWidth"] == 420


def test_workbench_layout_preferences_reject_out_of_range_sizes():
    try:
        UserPreferences.model_validate(
            {"workbench": {"layout": {"leftWidth": 120, "triViewFloat": {"w": 800}}}}
        )
    except ValidationError as exc:
        errors = {(tuple(err["loc"]), err["type"]) for err in exc.errors()}
    else:  # pragma: no cover
        raise AssertionError("expected validation error")

    assert (("workbench", "layout", "leftWidth"), "greater_than_equal") in errors
    assert (
        ("workbench", "layout", "triViewFloat", "w"),
        "less_than_equal",
    ) in errors
