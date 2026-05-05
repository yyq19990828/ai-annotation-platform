# How-to：新增前端页面

## 步骤

```
src/pages/<PageName>/
├── index.tsx              # 页面入口
├── components/            # 页面专属组件
├── hooks/                 # useXxx
├── state/                 # Zustand store（可选，复杂时启用）
└── __tests__/
    └── PageName.test.tsx
```

## 1. 入口组件

```tsx
// src/pages/Widgets/index.tsx
import { useQuery } from "@tanstack/react-query";
import { listWidgets } from "@/api/widgets";

export default function WidgetsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["widgets"],
    queryFn: listWidgets,
  });
  if (isLoading) return <div>加载中...</div>;
  return <ul>{data?.items.map((w) => <li key={w.id}>{w.name}</li>)}</ul>;
}
```

## 2. 路由 / Sidebar

按当前结构（`useAppStore.page`），在 `src/stores/appStore.ts` 加 `"widgets"` 字段，
然后在 `App.tsx` 的 page-switch 里加 case。

## 3. 单测

```tsx
// src/pages/Widgets/__tests__/Widgets.test.tsx
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import WidgetsPage from "../index";

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
};

it("空态：渲染空列表", async () => {
  server.use(http.get("*/api/v1/widgets", () => HttpResponse.json({ items: [] })));
  render(wrap(<WidgetsPage />));
  expect(await screen.findByRole("list")).toBeEmptyDOMElement();
});

it("有数据：渲染条目", async () => {
  server.use(
    http.get("*/api/v1/widgets", () =>
      HttpResponse.json({ items: [{ id: 1, name: "demo" }] }),
    ),
  );
  render(wrap(<WidgetsPage />));
  expect(await screen.findByText("demo")).toBeInTheDocument();
});
```

## 4. 样式

- 复用 `src/components/ui/` 的现成组件
- 自定义样式用 CSS Module：`Widgets.module.css`
- 不要新引入 CSS-in-JS 库
