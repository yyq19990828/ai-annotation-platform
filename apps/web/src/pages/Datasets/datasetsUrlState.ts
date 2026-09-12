import type { UrlStateCodec, UrlStateIssue } from "@/hooks/useUrlFilterState";

export const DATASET_DATA_TYPE_VALUES = ["image", "video", "point_cloud", "multimodal"] as const;
export type DatasetDataType = (typeof DATASET_DATA_TYPE_VALUES)[number];

export interface DatasetsUrlState {
  query: string;
  data_type?: DatasetDataType;
}

export const EMPTY_DATASETS_URL_STATE: DatasetsUrlState = {
  query: "",
  data_type: undefined,
};

export const DATASET_FILTER_KEYS = ["q", "data_type"] as const;

function isDatasetDataType(value: string): value is DatasetDataType {
  return (DATASET_DATA_TYPE_VALUES as readonly string[]).includes(value);
}

export function parseDatasetsUrlWithIssues(search: string | URLSearchParams): {
  state: DatasetsUrlState;
  issues: UrlStateIssue[];
} {
  const params = new URLSearchParams(typeof search === "string" ? search : search.toString());
  const issues: UrlStateIssue[] = [];
  const rawDataType = params.get("data_type")?.trim() ?? "";
  const dataType = rawDataType === "" || rawDataType === "all" ? undefined : rawDataType;
  if (dataType !== undefined && !isDatasetDataType(dataType)) {
    issues.push({ key: "data_type", message: "未知的数据集类型" });
  }
  return {
    state: {
      query: params.get("q")?.trim() ?? "",
      data_type: dataType !== undefined && isDatasetDataType(dataType) ? dataType : undefined,
    },
    issues,
  };
}

function updateDatasetsUrl(current: URLSearchParams, state: DatasetsUrlState): URLSearchParams {
  const next = new URLSearchParams(current);
  const query = state.query.trim();
  if (query) next.set("q", query);
  else next.delete("q");
  if (state.data_type) next.set("data_type", state.data_type);
  else next.delete("data_type");
  return next;
}

export const datasetsUrlCodec: UrlStateCodec<DatasetsUrlState> = {
  parse: parseDatasetsUrlWithIssues,
  encode: updateDatasetsUrl,
  clear: (current, defaults) => updateDatasetsUrl(current, defaults),
};

export function parseDatasetsUrl(search: string | URLSearchParams): DatasetsUrlState {
  return parseDatasetsUrlWithIssues(search).state;
}
