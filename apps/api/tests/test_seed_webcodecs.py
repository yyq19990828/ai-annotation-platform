"""WebCodecs 确定性 fixture 生成纯函数测试(v0.23.15 Phase B)。

验证 numpy→ffmpeg→ffprobe→avcC pipeline 产出与生产同结构的 chunk samples / codec
description,以及 unsupported / malformed 的确定性篡改。需要主机提供 ffmpeg / ffprobe;
缺失时测试明确失败，CI 不可静默放过核心 H.264 用例。
"""

from __future__ import annotations

import shutil

from app.api.v1._test_seed_webcodecs import (
    QUALIFICATION_CHUNK_SIZE_FRAMES,
    apply_metadata_mutation,
    frame_expectations,
    generate_fixture,
    generate_qualification_fixture,
)

_SAMPLE_KEYS = {
    "frame_index",
    "pts_ms",
    "duration_ms",
    "is_keyframe",
    "size_bytes",
    "offset_in_chunk",
}


def test_ffmpeg_prerequisites_are_available():
    missing = [tool for tool in ("ffmpeg", "ffprobe") if shutil.which(tool) is None]
    assert not missing, f"WebCodecs fixture prerequisites missing: {', '.join(missing)}"


def test_baseline_fixture_produces_production_shaped_samples(tmp_path):
    meta = generate_fixture("h264-baseline-gop12", tmp_path)
    assert meta["codec_string"].startswith("avc1.")
    assert meta["description"]  # base64 avcC
    assert meta["width"] == 160 and meta["height"] == 120
    assert meta["frame_count"] == 12

    samples = meta["samples"]
    assert len(samples) == 12
    # frame_index 是 0..11 的 presentation-rank 排列(前端按 timestamp 选目标)。
    assert sorted(s["frame_index"] for s in samples) == list(range(12))
    # baseline 共 12 帧且 GOP=12，关闭 scenecut 后只有首帧关键帧。
    key_fi = sorted(s["frame_index"] for s in samples if s["is_keyframe"])
    assert key_fi == [0]
    for s in samples:
        assert _SAMPLE_KEYS <= set(s)
        assert s["size_bytes"] > 0
        assert s["offset_in_chunk"] >= 0
    # mp4 字节非空,供前端按 offset 切片。
    assert meta["mp4_bytes"]


def test_qualification_fixture_produces_full_ready_chunk_contract(tmp_path):
    meta = generate_qualification_fixture("1080p-30", tmp_path)
    assert meta["width"] == 1920 and meta["height"] == 1080
    assert meta["fps"] == 30 and meta["frame_count"] == 1830
    assert len(meta["chunks"]) == 31
    assert [len(chunk["samples"]) for chunk in meta["chunks"]] == [
        *([QUALIFICATION_CHUNK_SIZE_FRAMES] * 30),
        30,
    ]
    assert meta["chunks"][0]["start_frame"] == 0
    assert meta["chunks"][-1]["end_frame"] == meta["frame_count"] - 1


def test_main_bframes_has_decode_presentation_reorder(tmp_path):
    meta = generate_fixture("h264-main-bframes-gop30", tmp_path)
    assert meta["codec_string"].startswith("avc1.4d")  # main profile
    decode_order = [s["frame_index"] for s in meta["samples"]]
    # B 帧:packet(decode)顺序 ≠ presentation rank 单调序列。
    assert decode_order != sorted(decode_order)
    # 但 frame_index 集合仍是完整排列(覆盖全部帧)。
    assert sorted(decode_order) == list(range(meta["frame_count"]))
    assert sorted(s["frame_index"] for s in meta["samples"] if s["is_keyframe"]) == [
        0,
        30,
    ]


def test_boundary_fixture_has_multiple_gops(tmp_path):
    meta = generate_fixture("h264-boundary-gop8", tmp_path)
    key_fi = [s["frame_index"] for s in meta["samples"] if s["is_keyframe"]]
    assert key_fi == [0, 8, 16]


def test_vfr_fixture_has_complete_monotonic_alternating_pts(tmp_path):
    meta = generate_fixture("h264-vfr", tmp_path)
    presented = sorted(meta["samples"], key=lambda sample: sample["frame_index"])
    assert len(presented) == meta["frame_count"] == 24
    assert [sample["frame_index"] for sample in presented] == list(range(24))
    pts_ms = [sample["pts_ms"] for sample in presented]
    deltas = [right - left for left, right in zip(pts_ms, pts_ms[1:])]
    assert all(32 <= delta <= 35 for delta in deltas[::2])
    assert all(65 <= delta <= 68 for delta in deltas[1::2])
    assert meta["duration_ms"] == max(
        sample["pts_ms"] + sample["duration_ms"] for sample in presented
    )
    assert meta["duration_ms"] > pts_ms[-1]


def test_apply_metadata_mutation_unsupported_keeps_description(tmp_path):
    base = generate_fixture("h264-baseline-gop12", tmp_path)
    mutated = apply_metadata_mutation("unsupported-config", base)
    assert mutated["codec_string"] == "avc1.ffff00"
    # 真实 avcC description 保留 → 前端 isConfigSupported 因 codec string 拒绝。
    assert mutated["description"] == base["description"]


def test_apply_metadata_mutation_malformed_pushes_offset_out_of_bounds(tmp_path):
    base = generate_fixture("h264-baseline-gop12", tmp_path)
    mutated = apply_metadata_mutation("malformed-samples", base)
    assert len(mutated["samples"]) == len(base["samples"])
    assert mutated["samples"][1]["offset_in_chunk"] == 10**9
    # 其余帧不变。
    assert mutated["samples"][0] == base["samples"][0]


def test_frame_expectations_structure_and_bit_encoding():
    exp = frame_expectations("h264-baseline-gop12")
    assert exp["scene_id"] == "h264-baseline-gop12"
    assert exp["frame_count"] == 12
    assert len(exp["frames"]) == 12
    assert exp["sample_regions"]["background"]["kind"] == "luma"
    assert len(exp["sample_regions"]["corners"]) == 4
    # 帧 0:四角 bit 全 0,背景基值。
    assert exp["frames"][0]["corner_bits"] == [0, 0, 0, 0]
    assert exp["frames"][0]["background_luma"] == 32
    # frame_index 低 4 位编码到 corner_bits(bit0=TL)。
    assert exp["frames"][1]["corner_bits"] == [1, 0, 0, 0]  # 1
    assert exp["frames"][5]["corner_bits"] == [1, 0, 1, 0]  # 5 = 0b0101
    assert exp["frames"][9]["corner_bits"] == [1, 0, 0, 1]  # 9 = 0b1001


def test_frame_expectations_include_sample_timestamps_and_unique_signatures(tmp_path):
    meta = generate_fixture("h264-main-bframes-gop30", tmp_path)
    exp = frame_expectations("h264-main-bframes-gop30", meta["samples"])
    assert exp["frames"][30]["pts_ms"] == 1000
    assert exp["frames"][30]["is_keyframe"] is True
    signatures = {
        (frame["background_luma"], tuple(frame["corner_bits"]))
        for frame in exp["frames"]
    }
    assert len(signatures) == exp["frame_count"] == 48


def test_frame_expectations_malformed_uses_real_baseline_frames():
    # unsupported / malformed 复用 baseline 真实编码,expectations 描述 baseline 帧签名。
    exp = frame_expectations("malformed-samples")
    assert exp["scene_color"] == "red"
    assert exp["frame_count"] == 12
