import { Tabs, TabsList, TabsTrigger } from "@/components/shadcn/ui/tabs";

/**
 * TabRow —— shadcn tabs 适配层(v0.17.2)。
 * 保留 `{tabs,active,onChange}` API(调用点零改动);仅用 TabsList/TabsTrigger 作受控筛选条,
 * 不渲染 TabsContent(面板由调用方自管)。
 */
interface TabRowProps {
  tabs: string[];
  active: string;
  onChange: (tab: string) => void;
}

export function TabRow({ tabs, active, onChange }: TabRowProps) {
  return (
    <Tabs value={active} onValueChange={onChange}>
      <TabsList>
        {tabs.map((t) => (
          <TabsTrigger key={t} value={t}>
            {t}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
