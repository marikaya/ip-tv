const EXTINF_PATTERN = /^#EXTINF:(?<duration>-?\d+)\s*(?<attributes>.*?),(?<title>.*)$/i;
const ATTRIBUTE_PATTERN = /([a-z0-9\-_]+)="(.*?)"/gi;
const EXTM3U_ATTRIBUTES_PATTERN = /^#EXTM3U\s*(?<attributes>.*)$/i;
const SERIES_NAME_PATTERN = /\bS\d{1,2}\s*E\d{1,3}\b/i;
const MOVIES_KEYWORDS = [
  "vod",
  "movie",
  "movies",
  "film",
  "filmler",
  "sinema",
  "kino"
];
const MOVIE_GROUP_KEYWORDS = [
  ...MOVIES_KEYWORDS,
  "aksiyon",
  "animasyon",
  "bilim kurgu",
  "bollywood",
  "drama",
  "fantastik",
  "gerilim",
  "komedi",
  "korku",
  "macera",
  "romantik",
  "western"
];
const SERIES_KEYWORDS = [
  "series",
  "serie",
  "serial",
  "dizi",
  "diziler",
  "dizileri",
  "season",
  "sezon",
  "episode",
  "bolum"
];
const SERIES_PATTERNS = [
  /^(?<series>.+?)\s+S(?<season>\d{1,2})\s*E(?<episode>\d{1,3})(?:\s*[-:]\s*(?<tail>.+))?$/i,
  /^(?<series>.+?)\s+(?<season>\d{1,2})\s*\.\s*(?:sezon|season)\s+(?<episode>\d{1,3})\s*\.\s*(?:bolum|bölüm|episode)\b(?:\s*[-:]\s*(?<tail>.+))?$/i,
  /^(?<series>.+?)\s+(?<episode>\d{1,4})\s*\.\s*(?:bolum|bölüm|episode)\b(?:\s*[-:]\s*(?<tail>.+))?$/i,
  /^(?<series>.+?)\s+(?<season>\d{1,2})\s*\.\s*(?:sezon|season)\b(?:\s*[-:]\s*(?<tail>.+))?$/i,
  /^(?<series>.+?)\s+(?:episode|ep)\s*(?<episode>\d{1,3})\b(?:\s*[-:]\s*(?<tail>.+))?$/i
];

function normalizeText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function cleanupText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function makeKey(prefix, ...parts) {
  const normalized = parts
    .map((part) => normalizeText(part).replace(/\s+/g, "-"))
    .filter(Boolean)
    .join("-");

  return normalized ? `${prefix}-${normalized}` : `${prefix}-item`;
}

function compareNames(left, right) {
  return left.localeCompare(right, "tr");
}

function parseAttributes(attributeText) {
  const attributes = {};

  for (const match of attributeText.matchAll(ATTRIBUTE_PATTERN)) {
    attributes[match[1].toLowerCase()] = match[2];
  }

  return attributes;
}

function parsePlaylistMetadata(rawPlaylist) {
  const firstLine = String(rawPlaylist || "").split(/\r?\n/, 1)[0]?.trim() || "";
  const match = firstLine.match(EXTM3U_ATTRIBUTES_PATTERN);

  if (!match?.groups?.attributes) {
    return { epgSource: "" };
  }

  const attributes = parseAttributes(match.groups.attributes);
  return {
    epgSource: cleanupText(attributes["x-tvg-url"] || attributes["url-tvg"] || "")
  };
}

function getEntryName(attributes, title) {
  return cleanupText(attributes["tvg-name"] || title || "");
}

function looksLikeDivider(name, groupTitle) {
  const value = cleanupText(name);
  const normalizedValue = normalizeText(value);
  const normalizedGroupTitle = normalizeText(groupTitle);

  if (!value) {
    return true;
  }

  if (/^\*{3,}.*\*{3,}$/.test(value)) {
    return true;
  }

  return normalizedValue.length > 0 && normalizedValue === normalizedGroupTitle;
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function stripLanguagePrefix(text) {
  return cleanupText(String(text || "").replace(/^[A-Z]{2,4}:\s*/i, ""));
}

function classifyEntry(entry) {
  const groupHaystack = normalizeText(entry.groupTitle);
  const itemHaystack = normalizeText([
    entry.name,
    entry.title,
    entry.tvgId
  ].join(" "));

  if (includesAny(groupHaystack, SERIES_KEYWORDS)) {
    return "series";
  }

  if (includesAny(groupHaystack, MOVIE_GROUP_KEYWORDS)) {
    return "movies";
  }

  if (SERIES_NAME_PATTERN.test(entry.name) || SERIES_NAME_PATTERN.test(entry.title)) {
    return "series";
  }

  if (includesAny(itemHaystack, SERIES_KEYWORDS)) {
    return "series";
  }

  if (includesAny(itemHaystack, MOVIES_KEYWORDS)) {
    return "movies";
  }

  return "live";
}

function createBucket(label) {
  return {
    label,
    items: [],
    groups: new Map()
  };
}

function createSeriesBucket(label) {
  return {
    label,
    items: [],
    groups: new Map()
  };
}

function ensureGroup(bucket, groupName) {
  if (!bucket.groups.has(groupName)) {
    bucket.groups.set(groupName, {
      id: makeKey("group", groupName),
      name: groupName,
      items: []
    });
  }

  return bucket.groups.get(groupName);
}

function getEpisodeLabel(meta, fallbackName) {
  if (meta.episodeNumber !== null) {
    const label = `${meta.episodeNumber}. Bolum`;
    return meta.tail ? `${label} - ${meta.tail}` : label;
  }

  if (meta.tail) {
    return meta.tail;
  }

  return cleanupText(fallbackName);
}

function extractSeriesInfo(entry) {
  const candidate = cleanupText(entry.name || entry.title);

  for (const pattern of SERIES_PATTERNS) {
    const match = candidate.match(pattern);

    if (!match || !match.groups || !match.groups.series) {
      continue;
    }

    const seasonNumber = match.groups.season ? Number(match.groups.season) : 1;
    const episodeNumber = match.groups.episode ? Number(match.groups.episode) : null;
    const seriesName = stripLanguagePrefix(match.groups.series);
    const tail = cleanupText(match.groups.tail || "");

    return {
      seriesName: seriesName || stripLanguagePrefix(candidate),
      seasonNumber,
      seasonName: `${seasonNumber}. Sezon`,
      episodeNumber,
      episodeLabel: getEpisodeLabel({ episodeNumber, tail }, candidate),
      tail
    };
  }

  const fallbackSeriesName = stripLanguagePrefix(candidate);

  return {
    seriesName: fallbackSeriesName || candidate,
    seasonNumber: 1,
    seasonName: "1. Sezon",
    episodeNumber: null,
    episodeLabel: fallbackSeriesName || candidate,
    tail: ""
  };
}

function ensureSeriesGroup(bucket, groupName) {
  if (!bucket.groups.has(groupName)) {
    bucket.groups.set(groupName, {
      id: makeKey("group", groupName),
      name: groupName,
      seriesMap: new Map()
    });
  }

  return bucket.groups.get(groupName);
}

function ensureSeries(group, item, seriesInfo) {
  const seriesKey = makeKey("series", group.name, seriesInfo.seriesName);

  if (!group.seriesMap.has(seriesKey)) {
    group.seriesMap.set(seriesKey, {
      id: seriesKey,
      name: seriesInfo.seriesName,
      groupTitle: group.name,
      logo: item.logo,
      seasonsMap: new Map()
    });
  }

  const series = group.seriesMap.get(seriesKey);

  if (!series.logo && item.logo) {
    series.logo = item.logo;
  }

  return series;
}

function ensureSeason(series, seasonNumber, seasonName) {
  const seasonKey = String(seasonNumber || 1);

  if (!series.seasonsMap.has(seasonKey)) {
    series.seasonsMap.set(seasonKey, {
      id: makeKey("season", series.id, seasonKey),
      name: seasonName,
      seasonNumber: seasonNumber || 1,
      episodes: []
    });
  }

  return series.seasonsMap.get(seasonKey);
}

function finalizeBucket(bucket) {
  const groups = Array.from(bucket.groups.values())
    .map((group) => ({
      ...group,
      itemCount: group.items.length,
      items: group.items.sort((left, right) => compareNames(left.name, right.name))
    }))
    .sort((left, right) => compareNames(left.name, right.name));

  return {
    label: bucket.label,
    itemCount: bucket.items.length,
    groupCount: groups.length,
    groups
  };
}

function finalizeSeriesBucket(bucket) {
  let totalSeries = 0;

  const groups = Array.from(bucket.groups.values())
    .map((group) => {
      const series = Array.from(group.seriesMap.values())
        .map((item) => {
          const seasons = Array.from(item.seasonsMap.values())
            .map((season) => ({
              ...season,
              episodeCount: season.episodes.length,
              episodes: season.episodes.sort((left, right) => {
                const leftOrder = left.episodeNumber ?? Number.MAX_SAFE_INTEGER;
                const rightOrder = right.episodeNumber ?? Number.MAX_SAFE_INTEGER;
                if (leftOrder !== rightOrder) {
                  return leftOrder - rightOrder;
                }

                return compareNames(left.episodeLabel, right.episodeLabel);
              })
            }))
            .sort((left, right) => left.seasonNumber - right.seasonNumber);

          const episodeCount = seasons.reduce((sum, season) => sum + season.episodeCount, 0);

          return {
            id: item.id,
            name: item.name,
            groupTitle: item.groupTitle,
            logo: item.logo || "",
            seasonCount: seasons.length,
            episodeCount,
            seasons
          };
        })
        .sort((left, right) => compareNames(left.name, right.name));

      totalSeries += series.length;

      const episodeCount = series.reduce((sum, item) => sum + item.episodeCount, 0);

      return {
        id: group.id,
        name: group.name,
        series,
        seriesCount: series.length,
        episodeCount
      };
    })
    .sort((left, right) => compareNames(left.name, right.name));

  return {
    label: bucket.label,
    itemCount: bucket.items.length,
    seriesCount: totalSeries,
    groupCount: groups.length,
    groups
  };
}

function parsePlaylist(rawPlaylist, source) {
  const metadata = parsePlaylistMetadata(rawPlaylist);
  const buckets = {
    live: createBucket("Canli TV"),
    movies: createBucket("Filmler"),
    series: createSeriesBucket("Diziler")
  };

  const lines = String(rawPlaylist || "").split(/\r?\n/);
  let pendingEntry = null;
  let sequence = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line === "#EXTM3U") {
      continue;
    }

    if (line.startsWith("#EXTINF")) {
      const match = line.match(EXTINF_PATTERN);

      if (!match || !match.groups) {
        pendingEntry = null;
        continue;
      }

      const attributes = parseAttributes(match.groups.attributes || "");
      const title = cleanupText(match.groups.title || "");
      const groupTitle = cleanupText(attributes["group-title"] || "Diger") || "Diger";
      const name = getEntryName(attributes, title);

      pendingEntry = {
        name,
        tvgName: cleanupText(attributes["tvg-name"] || ""),
        title,
        groupTitle,
        logo: cleanupText(attributes["tvg-logo"] || ""),
        tvgId: cleanupText(attributes["tvg-id"] || ""),
        duration: Number(match.groups.duration || -1)
      };
      continue;
    }

    if (line.startsWith("#") || !pendingEntry) {
      continue;
    }

    sequence += 1;
    const entry = {
      ...pendingEntry,
      id: `item-${sequence}`,
      url: line
    };
    pendingEntry = null;

    if (looksLikeDivider(entry.name, entry.groupTitle)) {
      continue;
    }

    const contentType = classifyEntry(entry);
    const item = {
      ...entry,
      contentType
    };

    if (contentType === "series") {
      const seriesGroup = ensureSeriesGroup(buckets.series, item.groupTitle);
      const seriesInfo = extractSeriesInfo(item);
      const series = ensureSeries(seriesGroup, item, seriesInfo);
      const season = ensureSeason(series, seriesInfo.seasonNumber, seriesInfo.seasonName);
      const episode = {
        ...item,
        seriesId: series.id,
        seriesName: seriesInfo.seriesName,
        seasonId: season.id,
        seasonName: season.name,
        seasonNumber: season.seasonNumber,
        episodeNumber: seriesInfo.episodeNumber,
        episodeLabel: seriesInfo.episodeLabel
      };

      season.episodes.push(episode);
      buckets.series.items.push(episode);
      continue;
    }

    const bucket = buckets[contentType];
    const group = ensureGroup(bucket, item.groupTitle);
    group.items.push(item);
    bucket.items.push(item);
  }

  const live = finalizeBucket(buckets.live);
  const movies = finalizeBucket(buckets.movies);
  const series = finalizeSeriesBucket(buckets.series);

  return {
    source,
    suggestedEpgSource: metadata.epgSource,
    counts: {
      total: live.itemCount + movies.itemCount + series.itemCount,
      live: live.itemCount,
      movies: movies.itemCount,
      series: series.itemCount,
      seriesTitles: series.seriesCount
    },
    categories: {
      live,
      movies,
      series
    }
  };
}

module.exports = {
  parsePlaylist
};
