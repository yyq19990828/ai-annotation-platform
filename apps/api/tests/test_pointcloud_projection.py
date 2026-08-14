from __future__ import annotations

import math

import pytest

from app.schemas._jsonb_types import SensorCalibration
from app.services.axis_convention import apply_convention_to_extrinsic, apply_to_psr
from app.services.pointcloud_projection import (
    project_box_to_image_bbox,
    transform_box_to_camera_psr,
)


def _identity_calibration() -> SensorCalibration:
    return SensorCalibration(
        extrinsic=[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        intrinsic=[100, 0, 100, 0, 100, 100, 0, 0, 1],
    )


def test_project_box_identity_fixture():
    bbox = project_box_to_image_bbox(
        {
            "center": [0.0, 0.0, 10.0],
            "size": [2.0, 2.0, 2.0],
            "rotation": [0.0, 0.0, 0.0],
        },
        _identity_calibration(),
        image_width=200,
        image_height=200,
    )

    assert bbox == pytest.approx((88.8888889, 88.8888889, 111.1111111, 111.1111111))


def test_project_box_matches_hand_calculated_kitti_oracle():
    calibration = SensorCalibration(
        extrinsic=[0, -1, 0, 0, 0, 0, -1, 0, 1, 0, 0, 0, 0, 0, 0, 1],
        intrinsic=[800, 0, 640, 0, 800, 360, 0, 0, 1],
    )
    psr = {
        "center": [10.0, 0.0, 0.0],
        "size": [4.0, 2.0, 2.0],
        "rotation": [0.0, 0.0, 0.0],
    }

    assert transform_box_to_camera_psr(psr, calibration)["center"] == pytest.approx(
        [0.0, 0.0, 10.0]
    )
    assert project_box_to_image_bbox(
        psr,
        calibration,
        image_width=1280,
        image_height=720,
    ) == pytest.approx((540.0, 260.0, 740.0, 460.0))


def test_axis_normalized_extrinsic_matches_source_projection():
    source_psr = {
        "center": [1.0, 2.0, 10.0],
        "size": [2.0, 2.0, 2.0],
        "rotation": [0.0, 0.0, 0.0],
    }
    source_calibration = _identity_calibration()
    iso_psr = apply_to_psr(source_psr, "sustechpoints_demo")
    iso_calibration = source_calibration.model_copy(
        update={
            "extrinsic": apply_convention_to_extrinsic(
                source_calibration.extrinsic,
                "sustechpoints_demo",
            )
        }
    )

    assert project_box_to_image_bbox(iso_psr, iso_calibration) == pytest.approx(
        project_box_to_image_bbox(source_psr, source_calibration)
    )


def test_project_box_clips_image_and_rejects_box_behind_camera():
    calibration = _identity_calibration()
    clipped = project_box_to_image_bbox(
        {
            "center": [8.0, 0.0, 10.0],
            "size": [4.0, 2.0, 2.0],
            "rotation": [0.0, 0.0, 0.0],
        },
        calibration,
        image_width=180,
        image_height=200,
    )
    behind = project_box_to_image_bbox(
        {
            "center": [0.0, 0.0, -10.0],
            "size": [2.0, 2.0, 2.0],
            "rotation": [0.0, 0.0, 0.0],
        },
        calibration,
    )

    assert clipped is not None
    assert clipped[2] == 180.0
    assert behind is None


def test_transform_box_uses_extrinsic_and_rect_for_center_and_heading():
    calibration = SensorCalibration(
        # ISO lidar (+X forward, +Y left, +Z up) -> KITTI camera (+X right, +Y down, +Z forward).
        extrinsic=[0, -1, 0, 0, 0, 0, -1, 0, 1, 0, 0, 0, 0, 0, 0, 1],
        intrinsic=[100, 0, 100, 0, 100, 100, 0, 0, 1],
        rect=[1, 0, 0, 1, 0, 1, 0, 2, 0, 0, 1, 3, 0, 0, 0, 1],
    )
    camera = transform_box_to_camera_psr(
        {
            "center": [10.0, 2.0, 1.0],
            "size": [4.0, 2.0, 1.5],
            "rotation": [0.0, 0.0, 0.0],
        },
        calibration,
    )

    assert camera["center"] == pytest.approx([-1.0, 1.0, 13.0])
    rx, ry, rz = camera["rotation"]
    assert rx == pytest.approx(math.pi / 2)
    assert ry == pytest.approx(0.0)
    assert rz == pytest.approx(math.pi / 2)
