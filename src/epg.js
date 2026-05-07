const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
  parseTagValue: false
});

function asArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function normalizeText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(hd|hq|fhd|uhd|4k)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getNodeText(node) {
  if (typeof node === "string") {
    return node.trim();
  }

  if (node && typeof node === "object") {
    if (typeof node["#text"] === "string") {
      return node["#text"].trim();
    }
  }

  return "";
}

function parseXmltvDate(value) {
  const match = String(value || "").trim().match(
    /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})(?<hour>\d{2})(?<minute>\d{2})(?<second>\d{2})(?:\s+(?<offset>[+-]\d{4}))?$/
  );

  if (!match || !match.groups) {
    return null;
  }

  const {
    year,
    month,
    day,
    hour,
    minute,
    second,
    offset
  } = match.groups;

  const utcTime = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );

  if (!offset) {
    return utcTime;
  }

  const sign = offset.startsWith("-") ? -1 : 1;
  const offsetHours = Number(offset.slice(1, 3));
  const offsetMinutes = Number(offset.slice(3, 5));
  const offsetMs = sign * ((offsetHours * 60) + offsetMinutes) * 60 * 1000;
  return utcTime - offsetMs;
}

function buildChannelIndex(channels) {
  const index = {};

  for (const channel of channels) {
    const id = String(channel.id || "").trim();
    const displayNames = asArray(channel["display-name"]).map(getNodeText).filter(Boolean);
    const icon = channel.icon?.src || "";

    if (!id) {
      continue;
    }

    index[id] = {
      id,
      displayNames,
      icon
    };
  }

  return index;
}

function createLookupKeys(channelId, channelInfo) {
  const keys = new Set();
  const add = (value) => {
    const normalized = normalizeText(value);
    if (normalized) {
      keys.add(normalized);
    }
  };

  add(channelId);

  for (const name of channelInfo.displayNames || []) {
    add(name);
    add(name.replace(/^TR:\s*/i, ""));
  }

  return Array.from(keys);
}

function summarizeProgramme(programme) {
  return {
    title: programme.title,
    description: programme.description,
    start: programme.start,
    stop: programme.stop
  };
}

function parseEpg(rawXml, source, now = Date.now()) {
  const document = parser.parse(String(rawXml || ""));
  const tv = document.tv || {};
  const channels = asArray(tv.channel);
  const programmes = asArray(tv.programme);
  const channelIndex = buildChannelIndex(channels);
  const listingByChannelId = {};

  for (const programme of programmes) {
    const channelId = String(programme.channel || "").trim();
    const start = parseXmltvDate(programme.start);
    const stop = parseXmltvDate(programme.stop);

    if (!channelId || !start || !stop) {
      continue;
    }

    const title = getNodeText(asArray(programme.title)[0]);
    const description = getNodeText(asArray(programme.desc)[0]);

    if (!listingByChannelId[channelId]) {
      listingByChannelId[channelId] = [];
    }

    listingByChannelId[channelId].push({
      title,
      description,
      start,
      stop
    });
  }

  const lookup = {};
  let programmeCount = 0;

  for (const [channelId, entries] of Object.entries(listingByChannelId)) {
    const sortedEntries = entries.sort((left, right) => left.start - right.start);
    programmeCount += sortedEntries.length;

    let current = null;
    let next = null;

    for (const entry of sortedEntries) {
      if (entry.start <= now && now < entry.stop) {
        current = summarizeProgramme(entry);
        continue;
      }

      if (entry.start > now) {
        next = summarizeProgramme(entry);
        break;
      }
    }

    if (!current && sortedEntries.length > 0) {
      const nearestUpcoming = sortedEntries.find((entry) => entry.start > now);
      if (nearestUpcoming) {
        next = summarizeProgramme(nearestUpcoming);
      }
    }

    const channelInfo = channelIndex[channelId] || { id: channelId, displayNames: [], icon: "" };
    const listing = {
      channelId,
      channelNames: channelInfo.displayNames,
      channelIcon: channelInfo.icon,
      current,
      next
    };

    for (const key of createLookupKeys(channelId, channelInfo)) {
      lookup[key] = listing;
    }
  }

  return {
    source,
    loadedAt: now,
    channelCount: Object.keys(channelIndex).length,
    programmeCount,
    lookup
  };
}

module.exports = {
  parseEpg,
  normalizeText
};
