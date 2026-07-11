const DOCUMENT_TIME_ZONE = "Asia/Shanghai";

export function currentDocumentDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DOCUMENT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
