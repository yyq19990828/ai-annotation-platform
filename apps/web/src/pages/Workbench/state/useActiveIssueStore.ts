/**
 * v0.11.4 · DiscussionPanel issues tab ↔ IssueLayer 图钉双向联动的轻量共享 store。
 *
 * - highlightId: 当前高亮的 issue feedback id。列表单击 / 图钉单击都写它，
 *   IssueLayer (pin 圆环加亮) 与 issues tab 列表行 (描边) 同时读它。
 * - focusTick: 列表 → 画布定位的请求计数。issues tab 单击列表项时 bump，
 *   model 监听后把视口平移到对应图钉。
 * - tabRequestTick: 画布 → tab 切换的请求计数。单击/hover 图钉、或工作台 issue FAB 时 bump，
 *   DiscussionPanel 监听后切到 issues tab。
 */
import { create } from "zustand";

interface ActiveIssueState {
  highlightId: string | null;
  focusTick: number;
  tabRequestTick: number;
  /** 列表单击：高亮 + 请求画布定位到该图钉。 */
  focusIssue: (id: string) => void;
  /** 图钉单击/hover：高亮 + 请求切到 issues tab。 */
  highlightFromPin: (id: string) => void;
  /** 仅请求切到 issues tab (工作台 issue FAB)，不改高亮。 */
  requestIssuesTab: () => void;
  /** 仅设置高亮 (hover 等不触发 tab 切换的场景)。 */
  setHighlightId: (id: string | null) => void;
}

export const useActiveIssueStore = create<ActiveIssueState>((set) => ({
  highlightId: null,
  focusTick: 0,
  tabRequestTick: 0,
  focusIssue: (id) => set((s) => ({ highlightId: id, focusTick: s.focusTick + 1 })),
  highlightFromPin: (id) => set((s) => ({ highlightId: id, tabRequestTick: s.tabRequestTick + 1 })),
  requestIssuesTab: () => set((s) => ({ tabRequestTick: s.tabRequestTick + 1 })),
  setHighlightId: (highlightId) => set({ highlightId }),
}));
