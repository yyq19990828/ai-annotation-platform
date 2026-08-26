from __future__ import annotations

import struct
import uuid

import numpy as np
import pytest

from app.services.point_cloud_quality.kernel import (
    Box3D,
    QualityThresholds,
    TrackInterval,
    TrackMember,
    evaluate_box,
    evaluate_track,
    parse_pcd_positions,
)


def _binary_pcd(points: list[tuple[float, float, float, float]]) -> bytes:
    header = (
        "VERSION .7\n"
        "FIELDS x y z intensity\n"
        "SIZE 4 4 4 4\n"
        "TYPE F F F F\n"
        "COUNT 1 1 1 1\n"
        f"WIDTH {len(points)}\n"
        "HEIGHT 1\n"
        f"POINTS {len(points)}\n"
        "DATA binary\n"
    ).encode()
    return header + b"".join(struct.pack("<ffff", *point) for point in points)


def test_binary_pcd_parser_reads_xyz_without_assuming_field_order() -> None:
    positions = parse_pcd_positions(_binary_pcd([(1, 2, 3, 0.2), (-1, -2, -3, 0.8)]))
    np.testing.assert_allclose(positions, [[1, 2, 3], [-1, -2, -3]])


def test_ascii_organized_pcd_uses_width_times_height_without_points_header() -> None:
    payload = (
        b"FIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\n"
        b"WIDTH 2\nHEIGHT 2\nDATA ascii\n"
        b"0 0 0  1 0 0  0 1 0  1 1 0\n"
    )
    np.testing.assert_allclose(
        parse_pcd_positions(payload),
        [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]],
    )


def test_box_rules_distinguish_low_points_ground_clearance_and_size() -> None:
    ground = [(x, y, 0.0) for x in np.linspace(-2, 2, 9) for y in (-1.0, 0.0, 1.0)]
    inside = [(0.0, 0.0, 0.6), (0.2, 0.1, 0.7)]
    points = np.asarray(ground + inside, dtype=np.float32)
    box = Box3D(center=(0, 0, 1.2), size=(4, 2, 2), rotation=(0, 0, 0))
    thresholds = QualityThresholds(
        minimum_points=3,
        ground_sample_min=8,
        ground_penetration_m=0.15,
        ground_float_m=0.35,
        size_min_samples=5,
        size_mad_z=3,
    )

    findings = evaluate_box(
        points,
        box,
        thresholds=thresholds,
        size_samples=[(4, 2, 2)] * 5,
    )
    assert {item.code for item in findings} == {"low_point_count"}

    floating = Box3D(center=(0, 0, 2), size=(4, 2, 2), rotation=(0, 0, 0))
    codes = {
        item.code
        for item in evaluate_box(
            points,
            floating,
            thresholds=thresholds,
            size_samples=[(4, 2, 2)] * 5,
        )
    }
    assert "ground_clearance" in codes

    outlier = Box3D(center=(0, 0, 1), size=(12, 2, 2), rotation=(0, 0, 0))
    finding = next(
        item
        for item in evaluate_box(
            points,
            outlier,
            thresholds=thresholds,
            size_samples=[
                (4, 2, 2),
                (4.1, 2, 2),
                (3.9, 2, 2),
                (4, 2.1, 2),
                (4, 1.9, 2),
            ],
        )
        if item.code == "size_outlier"
    )
    assert finding.metric["dimensions"] == [12, 2, 2]
    assert finding.severity == "warning"


def test_track_rules_respect_presence_intervals_and_are_deterministic() -> None:
    track_id = uuid.uuid4()
    first = TrackMember(
        annotation_id=uuid.uuid4(),
        frame_index=0,
        class_name="car",
        track_id="track-1",
        box=Box3D((0, 0, 1), (4, 2, 2), (0, 0, 0)),
        annotation_version=1,
    )
    duplicate = TrackMember(
        annotation_id=uuid.uuid4(),
        frame_index=0,
        class_name="car",
        track_id="track-1",
        box=first.box,
        annotation_version=1,
    )
    jumped = TrackMember(
        annotation_id=uuid.uuid4(),
        frame_index=2,
        class_name="truck",
        track_id="wrong-id",
        box=Box3D((20, 0, 1), (4, 2, 2), (0, 0, 0)),
        annotation_version=1,
    )
    findings = evaluate_track(
        scene_track_id=track_id,
        authoritative_class="car",
        authoritative_track_id="track-1",
        track_revision=3,
        presence_mode="explicit",
        intervals=[TrackInterval(0, 2, version=2)],
        members=[jumped, duplicate, first],
        thresholds=QualityThresholds(temporal_center_jump_m=5),
    )
    assert [item.code for item in findings] == [
        "duplicate_track_member",
        "temporal_jump",
        "track_gap",
        "track_identity_drift",
    ]
    gap = next(item for item in findings if item.code == "track_gap")
    assert gap.frame_start == gap.frame_end == 1
    assert gap.evidence["presence_mode"] == "explicit"
    jump = next(item for item in findings if item.code == "temporal_jump")
    assert jump.severity == "info"
    assert jump.evidence["pose_mode"] == "uncompensated"


def test_temporal_yaw_is_compensated_by_ego_pose() -> None:
    half_sqrt = float(np.sqrt(0.5))
    members = [
        TrackMember(
            annotation_id=uuid.uuid4(),
            frame_index=0,
            class_name="car",
            track_id="stationary",
            box=Box3D((10, 0, 1), (4, 2, 2), (0, 0, 0)),
            annotation_version=1,
            ego_translation=(0, 0, 0),
            ego_rotation=(1, 0, 0, 0),
        ),
        TrackMember(
            annotation_id=uuid.uuid4(),
            frame_index=1,
            class_name="car",
            track_id="stationary",
            box=Box3D((0, -10, 1), (4, 2, 2), (0, 0, -np.pi / 2)),
            annotation_version=1,
            ego_translation=(0, 0, 0),
            ego_rotation=(half_sqrt, 0, 0, half_sqrt),
        ),
    ]
    findings = evaluate_track(
        scene_track_id=uuid.uuid4(),
        authoritative_class="car",
        authoritative_track_id="stationary",
        track_revision=1,
        presence_mode="explicit",
        intervals=[TrackInterval(0, 1, version=1)],
        members=members,
        thresholds=QualityThresholds(temporal_yaw_jump_rad=0.5),
    )
    assert findings == []


def test_compressed_pcd_is_explicitly_unsupported() -> None:
    with pytest.raises(ValueError, match="binary_compressed"):
        parse_pcd_positions(
            b"FIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\n"
            b"WIDTH 1\nHEIGHT 1\nPOINTS 1\nDATA binary_compressed\n"
        )


def test_clean_box_and_track_are_true_negatives_for_every_rule() -> None:
    thresholds = QualityThresholds(
        minimum_points=3,
        ground_sample_min=6,
        size_min_samples=5,
        temporal_center_jump_m=5,
    )
    points = np.asarray(
        [(x, y, 0.0) for x in (-1.5, -0.5, 0.5, 1.5) for y in (-0.5, 0.5)]
        + [(0.0, 0.0, 0.5), (0.5, 0.0, 1.0), (-0.5, 0.0, 1.5)],
        dtype=np.float32,
    )
    box = Box3D((0, 0, 1), (4, 2, 2), (0, 0, 0))
    assert (
        evaluate_box(
            points,
            box,
            thresholds=thresholds,
            size_samples=[(4, 2, 2)] * 5,
        )
        == []
    )

    scene_track_id = uuid.uuid4()
    members = [
        TrackMember(
            annotation_id=uuid.uuid4(),
            frame_index=frame,
            class_name="car",
            track_id="track-clean",
            box=Box3D((float(frame), 0, 1), (4, 2, 2), (0, 0, 0)),
            annotation_version=1,
        )
        for frame in (0, 1)
    ]
    assert (
        evaluate_track(
            scene_track_id=scene_track_id,
            authoritative_class="car",
            authoritative_track_id="track-clean",
            track_revision=1,
            presence_mode="explicit",
            intervals=[TrackInterval(0, 1, version=1)],
            members=members,
            thresholds=thresholds,
        )
        == []
    )
