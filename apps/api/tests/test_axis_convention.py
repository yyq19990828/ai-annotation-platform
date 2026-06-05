from __future__ import annotations

import math

import pytest

from app.services.axis_convention import (
    R_NORM,
    apply_to_psr,
    sniff_convention_from_forward,
    transform_box_geometry_axis_frame,
    unapply_to_psr,
)


@pytest.mark.parametrize(
    ("convention", "expected_best"),
    [
        ("iso_8855", "iso_8855"),
        ("ros_rep103", "iso_8855"),
        ("kitti_camera", "kitti_camera"),
        ("opencv_camera", "kitti_camera"),
        ("apollo", "apollo"),
        ("y_forward", "apollo"),
        ("sustechpoints_demo", "sustechpoints_demo"),
    ],
)
def test_sniff_convention_from_forward_matches_r_norm_row0(
    convention,
    expected_best,
):
    m = R_NORM[convention]

    result = sniff_convention_from_forward(m[0], m[1], m[2])

    assert result is not None
    assert result["best"] == expected_best
    assert result["score"] == pytest.approx(1.0)
    assert any(
        c["convention"] == convention and c["score"] == pytest.approx(1.0)
        for c in result["candidates"]
    )


def test_apply_unapply_psr_round_trip():
    src = {
        "center": [1.5, -2.0, 3.25],
        "size": [4.0, 1.8, 1.6],
        "rotation": [0.1, -0.2, math.pi / 4],
    }

    iso = apply_to_psr(src, "apollo")
    out = unapply_to_psr(iso, "apollo")

    assert out["center"] == pytest.approx(src["center"])
    assert out["size"] == pytest.approx(src["size"])
    assert out["rotation"] == pytest.approx(src["rotation"])


def test_transform_box_geometry_axis_frame_source_keeps_extra_fields():
    geometry = {
        "type": "box_3d",
        "center": [0, 1, 0],
        "size": [4, 2, 1],
        "rotation": [0, 0, 0],
        "convention_at_create": "apollo",
    }

    out = transform_box_geometry_axis_frame(
        geometry,
        dataset_convention="apollo",
        axis_frame="source",
    )

    assert out["center"] == pytest.approx([-1, 0, 0])
    assert out["size"] == pytest.approx([4, 2, 1])
    assert out["axis_frame"] == "source"
    assert out["axis_convention"] == "apollo"
    assert out["convention_at_create"] == "apollo"


def test_transform_box_geometry_axis_frame_iso_is_noop_copy():
    geometry = {
        "type": "box_3d",
        "center": [0, 1, 0],
        "size": [1, 1, 1],
        "rotation": [0, 0, 0],
    }

    out = transform_box_geometry_axis_frame(
        geometry,
        dataset_convention="apollo",
        axis_frame="iso",
    )

    assert out == geometry
    assert out is not geometry
