"""Minimal per-sequence TrackEval HOTA, Identity and CLEAR metric subset."""

from __future__ import annotations

from typing import Any

import numpy as np
from scipy.optimize import linear_sum_assignment


ALPHAS = np.arange(0.05, 0.99, 0.05)
EPS = np.finfo(float).eps


def _counts(data: dict[str, Any]) -> tuple[int, int, int, int]:
    gt_dets = sum(len(ids) for ids in data["gt_ids"])
    tracker_dets = sum(len(ids) for ids in data["tracker_ids"])
    return gt_dets, tracker_dets, int(data["num_gt_ids"]), int(data["num_tracker_ids"])


def _hota(data: dict[str, Any]) -> dict[str, float]:
    gt_dets, tracker_dets, num_gt, num_tracker = _counts(data)
    tp = np.zeros(len(ALPHAS))
    fn = np.zeros(len(ALPHAS))
    fp = np.zeros(len(ALPHAS))
    loca = np.zeros(len(ALPHAS))
    if not tracker_dets:
        fn[:] = gt_dets
        return {"HOTA": 0.0, "DetA": 0.0, "AssA": 0.0}
    if not gt_dets:
        fp[:] = tracker_dets
        return {"HOTA": 0.0, "DetA": 0.0, "AssA": 0.0}

    potential = np.zeros((num_gt, num_tracker))
    gt_count = np.zeros((num_gt, 1))
    tracker_count = np.zeros((1, num_tracker))
    for gt_ids, tracker_ids, similarity in zip(
        data["gt_ids"], data["tracker_ids"], data["similarity_scores"], strict=True
    ):
        denominator = (
            similarity.sum(0)[None, :] + similarity.sum(1)[:, None] - similarity
        )
        weighted = np.zeros_like(similarity)
        mask = denominator > EPS
        weighted[mask] = similarity[mask] / denominator[mask]
        potential[gt_ids[:, None], tracker_ids[None, :]] += weighted
        gt_count[gt_ids] += 1
        tracker_count[0, tracker_ids] += 1

    alignment = potential / np.maximum(EPS, gt_count + tracker_count - potential)
    matched_counts = [np.zeros_like(potential) for _ in ALPHAS]
    for gt_ids, tracker_ids, similarity in zip(
        data["gt_ids"], data["tracker_ids"], data["similarity_scores"], strict=True
    ):
        if not len(gt_ids):
            fp += len(tracker_ids)
            continue
        if not len(tracker_ids):
            fn += len(gt_ids)
            continue
        rows, cols = linear_sum_assignment(
            -(alignment[gt_ids[:, None], tracker_ids[None, :]] * similarity)
        )
        for index, alpha in enumerate(ALPHAS):
            accepted = similarity[rows, cols] >= alpha - EPS
            matched_rows, matched_cols = rows[accepted], cols[accepted]
            matches = len(matched_rows)
            tp[index] += matches
            fn[index] += len(gt_ids) - matches
            fp[index] += len(tracker_ids) - matches
            if matches:
                loca[index] += similarity[matched_rows, matched_cols].sum()
                matched_counts[index][
                    gt_ids[matched_rows], tracker_ids[matched_cols]
                ] += 1

    assa = np.zeros(len(ALPHAS))
    for index, matched in enumerate(matched_counts):
        association = matched / np.maximum(1, gt_count + tracker_count - matched)
        assa[index] = np.sum(matched * association) / max(1, tp[index])
    deta = tp / np.maximum(1, tp + fn + fp)
    return {
        "HOTA": float(np.mean(np.sqrt(deta * assa))),
        "DetA": float(np.mean(deta)),
        "AssA": float(np.mean(assa)),
    }


def _identity(data: dict[str, Any], threshold: float = 0.5) -> dict[str, int | float]:
    gt_dets, tracker_dets, num_gt, num_tracker = _counts(data)
    if not tracker_dets:
        return {"IDF1": 0.0, "IDTP": 0, "IDFN": gt_dets, "IDFP": 0}
    if not gt_dets:
        return {"IDF1": 0.0, "IDTP": 0, "IDFN": 0, "IDFP": tracker_dets}
    potential = np.zeros((num_gt, num_tracker))
    gt_count = np.zeros(num_gt)
    tracker_count = np.zeros(num_tracker)
    for gt_ids, tracker_ids, similarity in zip(
        data["gt_ids"], data["tracker_ids"], data["similarity_scores"], strict=True
    ):
        rows, cols = np.nonzero(similarity >= threshold)
        potential[gt_ids[rows], tracker_ids[cols]] += 1
        gt_count[gt_ids] += 1
        tracker_count[tracker_ids] += 1
    size = num_gt + num_tracker
    fp_cost = np.zeros((size, size))
    fn_cost = np.zeros((size, size))
    fp_cost[num_gt:, :num_tracker] = 1e10
    fn_cost[:num_gt, num_tracker:] = 1e10
    for gt_id in range(num_gt):
        fn_cost[gt_id, :num_tracker] = gt_count[gt_id]
        fn_cost[gt_id, num_tracker + gt_id] = gt_count[gt_id]
    for tracker_id in range(num_tracker):
        fp_cost[:num_gt, tracker_id] = tracker_count[tracker_id]
        fp_cost[num_gt + tracker_id, tracker_id] = tracker_count[tracker_id]
    fn_cost[:num_gt, :num_tracker] -= potential
    fp_cost[:num_gt, :num_tracker] -= potential
    rows, cols = linear_sum_assignment(fn_cost + fp_cost)
    idfn = int(fn_cost[rows, cols].sum())
    idfp = int(fp_cost[rows, cols].sum())
    idtp = int(gt_count.sum()) - idfn
    return {
        "IDF1": idtp / max(1.0, idtp + 0.5 * (idfp + idfn)),
        "IDTP": idtp,
        "IDFN": idfn,
        "IDFP": idfp,
    }


def _clear(data: dict[str, Any], threshold: float = 0.5) -> dict[str, int | float]:
    gt_dets, tracker_dets, num_gt, _ = _counts(data)
    if not gt_dets:
        return {"MOTA": 0.0, "IDSW": 0, "FP": tracker_dets, "FN": 0, "Frag": 0}
    if not tracker_dets:
        return {"MOTA": 0.0, "IDSW": 0, "FP": 0, "FN": gt_dets, "Frag": 0}
    fp = fn = idsw = 0
    gt_seen = np.zeros(num_gt)
    gt_matched = np.zeros(num_gt)
    fragments = np.zeros(num_gt)
    previous = np.full(num_gt, np.nan)
    previous_frame = np.full(num_gt, np.nan)
    for gt_ids, tracker_ids, similarity in zip(
        data["gt_ids"], data["tracker_ids"], data["similarity_scores"], strict=True
    ):
        if not len(gt_ids):
            fp += len(tracker_ids)
            continue
        gt_seen[gt_ids] += 1
        if not len(tracker_ids):
            fn += len(gt_ids)
            continue
        score = 1000 * (tracker_ids[None, :] == previous_frame[gt_ids[:, None]]) + similarity
        score[similarity < threshold - EPS] = 0
        rows, cols = linear_sum_assignment(-score)
        keep = score[rows, cols] > EPS
        rows, cols = rows[keep], cols[keep]
        matched_gt, matched_tracker = gt_ids[rows], tracker_ids[cols]
        idsw += int(
            np.sum((~np.isnan(previous[matched_gt])) & (previous[matched_gt] != matched_tracker))
        )
        was_untracked = np.isnan(previous_frame)
        previous[matched_gt] = matched_tracker
        previous_frame[:] = np.nan
        previous_frame[matched_gt] = matched_tracker
        fragments += was_untracked & ~np.isnan(previous_frame)
        gt_matched[matched_gt] += 1
        fp += len(tracker_ids) - len(rows)
        fn += len(gt_ids) - len(rows)
    frag = int(np.sum(np.maximum(0, fragments - 1)))
    return {
        "MOTA": (gt_dets - fn - fp - idsw) / max(1.0, gt_dets),
        "IDSW": idsw,
        "FP": fp,
        "FN": fn,
        "Frag": frag,
    }


def _swap(data: dict[str, Any]) -> dict[str, Any]:
    return {
        "gt_ids": data["tracker_ids"],
        "tracker_ids": data["gt_ids"],
        "similarity_scores": [matrix.T for matrix in data["similarity_scores"]],
        "num_gt_ids": data["num_tracker_ids"],
        "num_tracker_ids": data["num_gt_ids"],
    }


def evaluate_sequence(data: dict[str, Any]) -> dict[str, int | float]:
    """Evaluate one overlap, treating left as reference and reporting reverse MOTA."""
    result = {**_hota(data), **_identity(data)}
    left = _clear(data)
    right = _clear(_swap(data))
    result.update(
        {
            "MOTA_left": left["MOTA"],
            "MOTA_right": right["MOTA"],
            "IDSW": left["IDSW"],
            "FP": left["FP"],
            "FN": left["FN"],
            "Frag": left["Frag"],
            "valid_frames": len(data["gt_ids"]),
        }
    )
    return result
