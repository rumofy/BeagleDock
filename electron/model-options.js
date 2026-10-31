const validId = (value) =>
  typeof value === "string" && /^[a-z0-9][a-z0-9._:/-]*$/i.test(value);
const validEffort = (value) =>
  typeof value === "string" && /^[a-z][a-z0-9_-]{0,40}$/i.test(value);
function metadataModels(models, provider) {
  return (Array.isArray(models) ? models : []).flatMap((model) => {
    const id = typeof model === "string" ? model : model?.slug || model?.id;
    if (!validId(id)) return [];
    if (typeof model === "string")
      return [
        { id, label: id, aliases: [], efforts: [], requiresEffort: false },
      ];
    const advertised =
      provider === "claude"
        ? model.thinking?.effort_options || model.runtime?.effort_levels
        : model.supported_reasoning_levels;
    const efforts = (Array.isArray(advertised) ? advertised : []).flatMap(
      (level) => {
        const effort =
          typeof level === "string" ? level : level.id || level.effort;
        return validEffort(effort)
          ? [
              {
                id: effort,
                label:
                  typeof level === "object" ? level.name || effort : effort,
                description:
                  typeof level === "object" ? level.description : undefined,
              },
            ]
          : [];
      },
    );
    return [
      {
        id,
        label: model.display_name || model.name || id,
        aliases: [model.short_name].filter((x) => typeof x === "string"),
        efforts,
        defaultEffort:
          provider === "claude"
            ? model.runtime?.default_effort
            : model.default_reasoning_level,
        requiresEffort: false,
      },
    ];
  });
}
function parseAgyRows(stdout) {
  try {
    const json = JSON.parse(stdout);
    return (Array.isArray(json) ? json : json.models || []).flatMap((m) => {
      const id = typeof m === "string" ? m : m?.id || m?.slug;
      return validId(id)
        ? [
            {
              id,
              label: typeof m === "string" ? m : m.display_name || m.name || id,
            },
          ]
        : [];
    });
  } catch {}
  return stdout
    .replace(/\x1b\[[0-9;]*m/g, "")
    .split("\n")
    .flatMap((line) => {
      const [first, ...rest] = line
        .trim()
        .replace(/^[*✓]\s*/, "")
        .split("\t");
      const id = first?.split(/\s+/)[0];
      return validId(id) && /[-.]/.test(id)
        ? [{ id, label: rest.join("\t").trim() || id }]
        : [];
    });
}
function agyModels(rows, activeModel = "") {
  const grouped = new Map();
  for (const row of rows) {
    // Derive the level from the CLI's display label, never from a bundled list of levels.
    const labelMatch = row.label.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    const suffix = row.id.match(/^(.*)-([a-z][a-z0-9_-]*)$/i);
    const labelLevel = labelMatch?.[2].toLowerCase().replace(/\s+/g, "");
    const split =
      labelMatch &&
      suffix &&
      validEffort(suffix[2]) &&
      suffix[2] === labelLevel;
    const id = split ? suffix[1] : row.id;
    let option = grouped.get(id);
    if (!option) {
      option = {
        id,
        label: split ? labelMatch[1].trim() : row.label,
        aliases: [],
        efforts: [],
        requiresEffort: !!split,
        nativeModel: split ? undefined : row.id,
      };
      grouped.set(id, option);
    }
    option.aliases.push(row.id, row.label);
    if (split)
      option.efforts.push({
        id: suffix[2],
        label: labelMatch[2],
        nativeModel: row.id,
        aliases: [row.label],
      });
  }
  for (const option of grouped.values()) {
    const active = option.efforts.find(
      (e) => e.nativeModel === activeModel || e.aliases.includes(activeModel),
    );
    option.defaultEffort = active?.id || option.efforts[0]?.id;
  }
  return [...grouped.values()];
}
function resolveModelSelection(options, model, effort = "") {
  const match = (value, target) =>
    typeof value === "string" && value.toLowerCase() === target.toLowerCase();
  if (!model) {
    if (effort)
      throw new Error(
        "Escolha um modelo do catálogo antes de definir o nível.",
      );
    return { model: "", effort: "" };
  }
  const option = options.find(
    (o) =>
      match(o.id, model) ||
      o.aliases?.some((a) => match(a, model)) ||
      o.efforts.some(
        (e) =>
          e.nativeModel === model || e.aliases?.some((a) => match(a, model)),
      ),
  );
  if (!option) {
    if (options.length)
      throw new Error(
        "O modelo salvo não está no catálogo atual. Selecione um modelo disponível.",
      );
    if (effort)
      throw new Error(
        "A CLI ainda não informou os níveis deste modelo. Use o padrão da CLI.",
      );
    return { model, effort: "" };
  }
  const legacy =
    model !== option.id
      ? option.efforts.find(
          (e) =>
            e.nativeModel === model || e.aliases?.some((a) => match(a, model)),
        )
      : undefined;
  const chosen =
    legacy?.id || effort || (option.requiresEffort ? option.defaultEffort : "");
  if (chosen && !option.efforts.some((e) => e.id === chosen))
    throw new Error(
      "O nível selecionado não está disponível para este modelo no catálogo atual.",
    );
  const level = option.efforts.find((e) => e.id === chosen);
  return {
    model: level?.nativeModel || option.nativeModel || option.id,
    effort: level?.nativeModel ? "" : chosen,
  };
}
module.exports = {
  metadataModels,
  parseAgyRows,
  agyModels,
  resolveModelSelection,
};
