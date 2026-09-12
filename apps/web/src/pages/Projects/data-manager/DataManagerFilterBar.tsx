import type { ReactNode } from "react";

import type { DataManagerFilterField } from "@/api/taskViews";
import { FilterBar } from "@/components/filters/FilterBar";
import type { FilterChip, QuickFilter } from "@/lib/filters/types";

export interface DataManagerFilterChip {
  id: FilterChip["id"];
  label: FilterChip["label"];
  value: FilterChip["value"];
  invalid?: boolean;
  editor: ReactNode;
}

export type DataManagerQuickFilter = QuickFilter;

export function DataManagerFilterBar({
  fields,
  chips,
  quickFilters = [],
  onAdd,
  onClear,
  hasConditions,
}: {
  fields: DataManagerFilterField[];
  chips: DataManagerFilterChip[];
  quickFilters?: DataManagerQuickFilter[];
  onAdd: (field: DataManagerFilterField) => void;
  onClear: () => void;
  hasConditions?: boolean;
}) {
  return (
    <FilterBar
      fields={fields}
      chips={chips}
      quickFilters={quickFilters}
      onAdd={(field) => onAdd(field as DataManagerFilterField)}
      onClear={onClear}
      clearLabel="清除条件"
      hasConditions={hasConditions}
    />
  );
}
