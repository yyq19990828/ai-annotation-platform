import { ActiveFilterChip } from "@/components/filters/ActiveFilterChip";
import { Button } from "@/components/ui/Button";
import { useUsers } from "@/hooks/useUsers";
import { PROJECT_DATA_TYPES } from "@/constants/toolUnits";
import type { DashboardFilters } from "./dashboardUrlState";

export function ProjectFilterSummary({
  filters,
  onChange,
  onEdit,
}: {
  filters: DashboardFilters;
  onChange: (next: DashboardFilters) => void;
  onEdit: () => void;
}) {
  const { data: users = [] } = useUsers();
  if (
    !filters.data_type.length &&
    !filters.member_id &&
    !filters.created_from &&
    !filters.created_to
  )
    return null;
  return (
    <div
      role="group"
      aria-label="已应用的项目筛选"
      className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2"
    >
      {!!filters.data_type.length && (
        <ActiveFilterChip
          label="数据类型"
          value={PROJECT_DATA_TYPES.filter((type) => filters.data_type.includes(type.id))
            .map((type) => type.label)
            .join("、")}
          onClick={onEdit}
          onRemove={() => onChange({ ...filters, data_type: [] })}
        />
      )}
      {filters.member_id && (
        <ActiveFilterChip
          label="成员"
          value={users.find((user) => user.id === filters.member_id)?.name ?? "指定成员"}
          onClick={onEdit}
          onRemove={() => onChange({ ...filters, member_id: undefined })}
        />
      )}
      {(filters.created_from || filters.created_to) && (
        <ActiveFilterChip
          label="创建时间"
          value={`${filters.created_from ?? "不限"} 至 ${filters.created_to ?? "不限"}`}
          onClick={onEdit}
          onRemove={() => onChange({ ...filters, created_from: undefined, created_to: undefined })}
        />
      )}
      <Button
        size="xs"
        variant="ghost"
        onClick={() =>
          onChange({
            ...filters,
            data_type: [],
            member_id: undefined,
            created_from: undefined,
            created_to: undefined,
          })
        }
      >
        清除附加条件
      </Button>
    </div>
  );
}
