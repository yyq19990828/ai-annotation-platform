from app.workers.media import parse_ffprobe_packet_samples


def test_parse_ffprobe_packet_samples_assigns_presentation_rank():
    # Decode order with a B-frame: pts is non-monotonic (0.0 / 0.066 / 0.033).
    samples = parse_ffprobe_packet_samples(
        {
            "packets": [
                {
                    "pts_time": "0.000000",
                    "duration_time": "0.033367",
                    "size": "5000",
                    "pos": "48",
                    "flags": "K__",
                },
                {
                    "pts_time": "0.066733",
                    "duration_time": "0.033367",
                    "size": "1200",
                    "pos": "5048",
                    "flags": "___",
                },
                {
                    "pts_time": "0.033367",
                    "duration_time": "0.033367",
                    "size": "800",
                    "pos": "6248",
                    "flags": "___",
                },
            ]
        },
        start_frame=10,
    )

    # Decode order preserved (3 items).
    assert len(samples) == 3
    assert [s["offset_in_chunk"] for s in samples] == [48, 5048, 6248]

    # frame_index assigned by presentation (pts) rank, not decode order.
    # pts 0.0 -> 10, pts 0.033 -> 11, pts 0.066 -> 12
    assert [s["frame_index"] for s in samples] == [10, 12, 11]
    assert [s["pts_ms"] for s in samples] == [0, 67, 33]

    assert samples[0]["is_keyframe"] is True
    assert samples[1]["is_keyframe"] is False
    assert samples[2]["is_keyframe"] is False

    assert [s["size_bytes"] for s in samples] == [5000, 1200, 800]
    assert [s["duration_ms"] for s in samples] == [33, 33, 33]


def test_parse_ffprobe_packet_samples_skips_invalid_packets():
    samples = parse_ffprobe_packet_samples(
        {
            "packets": [
                {
                    "pts_time": "0.000000",
                    "duration_time": "0.033367",
                    "size": "5000",
                    "pos": "48",
                    "flags": "K__",
                },
                # pos is missing -> skipped
                {
                    "pts_time": "0.033367",
                    "duration_time": "0.033367",
                    "size": "800",
                    "flags": "___",
                },
                # pts_time N/A -> skipped
                {
                    "pts_time": "N/A",
                    "duration_time": "0.033367",
                    "size": "800",
                    "pos": "6248",
                    "flags": "___",
                },
            ]
        },
        start_frame=0,
    )

    assert len(samples) == 1
    assert samples[0]["offset_in_chunk"] == 48
    assert samples[0]["frame_index"] == 0


def test_parse_ffprobe_packet_samples_empty():
    assert parse_ffprobe_packet_samples({}, start_frame=0) == []
    assert parse_ffprobe_packet_samples({"packets": []}, start_frame=5) == []
