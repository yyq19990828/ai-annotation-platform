import { useMemo, useState, type ReactNode } from "react";

import type { DataManagerFilterField } from "@/api/taskViews";
import { Input } from "@/components/shadcn/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/shadcn/ui/popover";
import { Separator } from "@/components/shadcn/ui/separator";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export interface DataManagerFilterChip {
  id: string;
  label: string;
  value: string;
  editor: ReactNode;
}

export interface DataManagerQuickFilter {
  key: string;
  label: string;
  active: boolean;
  onClick: () => void;
}

export function DataManagerFilterBar({
  fields,
  chips,
  quickFilters = [],
  onAdd,
  onClear,
}: {
  fields: DataManagerFilterField[];
  chips: DataManagerFilterChip[];
  quickFilters?: DataManagerQuickFilter[];
  onAdd: (field: DataManagerFilterField) => void;
  onClear: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fieldQuery, setFieldQuery] = useState("");
  const groupedFields = useMemo(() => {
    const query = fieldQuery.trim().toLocaleLowerCase();
    const groups = new Map<string, DataManagerFilterField[]>();
    for (const field of fields) {
      if (
        query &&
        !`${field.label} ${field.key} ${field.group}`.toLocaleLowerCase().includes(query)
      ) {
        continue;
      }
      const items = groups.get(field.group) ?? [];
      items.push(field);
      groups.set(field.group, items);
    }
    return [...groups.entries()];
  }, [fieldQuery, fields]);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {quickFilters.map((filter) => (
        <Button
          key={filter.key}
          size="sm"
          variant={filter.active ? "primary" : "ghost"}
          aria-pressed={filter.active}
          onClick={filter.onClick}
          className="h-8"
        >
          {filter.label}
        </Button>
      ))}
      {!!quickFilters.length && <Separator orientation="vertical" className="mx-0.5 h-6" />}
      {chips.map((chip) => (
        <Popover key={chip.id}>
          <PopoverTrigger asChild>
            <Button size="sm" className="h-8 max-w-64 gap-1.5">
              <span className="truncate">{chip.label}</span>
              <span className="truncate text-muted-foreground">{chip.value}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)]">
            <PopoverHeader>
              <PopoverTitle>{chip.label}</PopoverTitle>
              <PopoverDescription>修改操作符或条件值。</PopoverDescription>
            </PopoverHeader>
            <div className="mt-3">{chip.editor}</div>
          </PopoverContent>
        </Popover>
      ))}
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button size="sm" className="h-8">
            <Icon name="plus" size={12} />
            筛选
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-2">
          <PopoverHeader className="px-1 pt-1">
            <PopoverTitle>添加筛选</PopoverTitle>
            <PopoverDescription>按名称或字段标识搜索。</PopoverDescription>
          </PopoverHeader>
          <Input
            value={fieldQuery}
            onChange={(event) => setFieldQuery(event.target.value)}
            placeholder="搜索筛选字段"
            aria-label="搜索筛选字段"
            className="my-2 h-8"
          />
          <div className="max-h-80 overflow-y-auto">
            {groupedFields.map(([group, items]) => (
              <div key={group} className="mb-2 last:mb-0">
                <div className="px-2 py-1 text-2xs font-medium text-muted-foreground">{group}</div>
                {items.map((field) => (
                  <Button
                    key={field.key}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-between gap-3 px-2 text-left font-normal"
                    onClick={() => {
                      onAdd(field);
                      setPickerOpen(false);
                      setFieldQuery("");
                    }}
                  >
                    <span>{field.label}</span>
                    <span className="truncate font-mono text-2xs text-muted-foreground">
                      {field.key}
                    </span>
                  </Button>
                ))}
              </div>
            ))}
            {!groupedFields.length && (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                没有匹配字段
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {!!chips.length && (
        <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={onClear}>
          清除全部
        </Button>
      )}
    </div>
  );
}
