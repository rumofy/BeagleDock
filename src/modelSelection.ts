import type { ModelOption } from "./types";
export function modelSelection(
  options: ModelOption[],
  model: string,
  effort: string,
) {
  const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const option = options.find(
    (o) =>
      equal(o.id, model) ||
      o.aliases.some((a) => equal(a, model)) ||
      o.efforts.some(
        (e) =>
          e.nativeModel === model || e.aliases?.some((a) => equal(a, model)),
      ),
  );
  const legacy =
    option && model !== option.id
      ? option.efforts.find(
          (e) =>
            e.nativeModel === model || e.aliases?.some((a) => equal(a, model)),
        )
      : undefined;
  const selected =
    legacy?.id ||
    (option?.efforts.some((e) => e.id === effort) ? effort : "") ||
    (option?.requiresEffort
      ? option.defaultEffort || option.efforts[0]?.id
      : "") ||
    "";
  return { model: option?.id || model, effort: selected, option };
}
