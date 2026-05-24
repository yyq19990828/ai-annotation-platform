import { describe, expect, it } from "vitest";
import {
  filterNotificationItems,
  groupNotificationItems,
} from "./NotificationsPopover.helpers";
import type { NotificationItem } from "@/api/notifications";

function makeNotification(
  overrides: Partial<NotificationItem>,
): NotificationItem {
  return {
    id: "n-1",
    type: "task.rejected",
    target_type: "task",
    target_id: "target-1",
    payload: {},
    read_at: null,
    created_at: "2026-05-24T08:00:00Z",
    ...overrides,
  };
}

describe("NotificationsPopover helpers", () => {
  it("filters loaded notifications by target_type", () => {
    const items = [
      makeNotification({ id: "task", target_type: "task" }),
      makeNotification({ id: "batch", target_type: "batch" }),
      makeNotification({ id: "job", target_type: "async_job" }),
    ];

    expect(filterNotificationItems(items, "all")).toHaveLength(3);
    expect(filterNotificationItems(items, "batch").map((item) => item.id)).toEqual([
      "batch",
    ]);
    expect(filterNotificationItems(items, "async_job").map((item) => item.id)).toEqual([
      "job",
    ]);
  });

  it("groups notifications into today, this week and earlier", () => {
    const now = new Date("2026-05-24T12:00:00");
    const grouped = groupNotificationItems(
      [
        makeNotification({ id: "today", created_at: "2026-05-24T01:00:00" }),
        makeNotification({ id: "week", created_at: "2026-05-20T01:00:00" }),
        makeNotification({ id: "earlier", created_at: "2026-05-10T01:00:00" }),
      ],
      now,
    );

    expect(grouped.today.map((item) => item.id)).toEqual(["today"]);
    expect(grouped.week.map((item) => item.id)).toEqual(["week"]);
    expect(grouped.earlier.map((item) => item.id)).toEqual(["earlier"]);
  });
});
