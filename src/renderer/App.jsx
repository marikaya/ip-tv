import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import mpegts from "mpegts.js";
import {
  Alert,
  Avatar,
  Breadcrumb,
  Button,
  Card,
  Divider,
  Dropdown,
  Drawer,
  Empty,
  Flex,
  Input,
  Layout,
  Modal,
  Segmented,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography
} from "antd";
import {
  FolderOpenOutlined,
  DownOutlined,
  HeartFilled,
  HeartOutlined,
  HistoryOutlined,
  MenuOutlined,
  PlayCircleFilled,
  ReloadOutlined,
  SearchOutlined,
  SettingOutlined,
  StepBackwardOutlined,
  StepForwardOutlined,
  VideoCameraOutlined,
  VideoCameraAddOutlined,
  WifiOutlined
} from "@ant-design/icons";

const { Header, Content, Footer, Sider } = Layout;
const { Text, Title } = Typography;

const STORAGE_KEYS = {
  source: "deneme.playlistSource",
  epgSource: "deneme.epgSource",
  history: "deneme.watchHistory",
  favorites: "deneme.favorites",
  positions: "deneme.playbackPositions"
};
const MAX_HISTORY_ITEMS = 12;
const DRAWER_WIDTH = 300;
const CATEGORY_CONFIG = {
  live: { label: "Canli TV", shortLabel: "TV", icon: <WifiOutlined /> },
  movies: { label: "Filmler", shortLabel: "Film", icon: <VideoCameraOutlined /> },
  series: { label: "Diziler", shortLabel: "Dizi", icon: <VideoCameraAddOutlined /> }
};
function readStoredJson(key, fallbackValue) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function writeStoredJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase();
}

function formatSource(source) {
  if (!source) {
    return "URL yerel olarak kaydedilir, kaynak koduna yazilmaz.";
  }

  return source.length > 120 ? `${source.slice(0, 117)}...` : source;
}

function labelForCategory(category) {
  return CATEGORY_CONFIG[category]?.label || "Canli TV";
}

function formatTimestamp(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function matchesSearch(value, needle) {
  const text = typeof value === "string"
    ? value
    : [
      value.name,
      value.title,
      value.groupTitle,
      value.seriesName,
      value.episodeLabel,
      value.seasonName
    ].filter(Boolean).join(" ");

  return normalize(text).includes(needle);
}

function cloneSeriesForSearch(series, needle) {
  if (matchesSearch(series, needle)) {
    return series;
  }

  const seasons = series.seasons
    .map((season) => {
      if (matchesSearch(season.name, needle)) {
        return season;
      }

      const episodes = season.episodes.filter((episode) => matchesSearch(episode, needle));
      return episodes.length > 0 ? { ...season, episodeCount: episodes.length, episodes } : null;
    })
    .filter(Boolean);

  if (seasons.length === 0) {
    return null;
  }

  return {
    ...series,
    seasonCount: seasons.length,
    episodeCount: seasons.reduce((sum, season) => sum + season.episodeCount, 0),
    seasons
  };
}

function getVisibleGroups(playlist, activeCategory, searchTerm) {
  const category = playlist?.categories?.[activeCategory];
  if (!category) {
    return [];
  }

  if (!searchTerm) {
    return category.groups;
  }

  if (activeCategory === "series") {
    return category.groups
      .map((group) => {
        if (matchesSearch(group.name, searchTerm)) {
          return group;
        }

        const series = group.series
          .map((item) => cloneSeriesForSearch(item, searchTerm))
          .filter(Boolean);

        if (series.length === 0) {
          return null;
        }

        return {
          ...group,
          series,
          seriesCount: series.length,
          episodeCount: series.reduce((sum, item) => sum + item.episodeCount, 0)
        };
      })
      .filter(Boolean);
  }

  return category.groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => matchesSearch(item, searchTerm))
    }))
    .filter((group) => matchesSearch(group.name, searchTerm) || group.items.length > 0);
}

function defaultSelectionState(playlist) {
  const initial = {
    selectedGroupId: { live: null, movies: null, series: null },
    selectedItemId: { live: null, movies: null },
    selectedSeriesId: null,
    selectedSeasonId: null,
    selectedEpisodeId: null
  };

  if (!playlist) {
    return initial;
  }

  for (const categoryName of ["live", "movies", "series"]) {
    const firstGroup = playlist.categories[categoryName].groups[0] || null;
    initial.selectedGroupId[categoryName] = firstGroup?.id ?? null;

    if (categoryName === "series") {
      const firstSeries = firstGroup?.series?.[0] || null;
      const firstSeason = firstSeries?.seasons?.[0] || null;
      const firstEpisode = firstSeason?.episodes?.[0] || null;
      initial.selectedSeriesId = firstSeries?.id ?? null;
      initial.selectedSeasonId = firstSeason?.id ?? null;
      initial.selectedEpisodeId = firstEpisode?.id ?? null;
    } else {
      initial.selectedItemId[categoryName] = firstGroup?.items?.[0]?.id ?? null;
    }
  }

  return initial;
}

function resolveSelection(visibleGroups, activeCategory, selectionState) {
  const group = visibleGroups.find((item) => item.id === selectionState.selectedGroupId[activeCategory]) || visibleGroups[0] || null;

  if (!group) {
    return {
      groupId: null,
      itemId: null,
      seriesId: null,
      seasonId: null,
      episodeId: null,
      group: null,
      series: null,
      season: null,
      item: null
    };
  }

  if (activeCategory === "series") {
    const series = group.series.find((item) => item.id === selectionState.selectedSeriesId) || group.series[0] || null;
    const season = series?.seasons.find((item) => item.id === selectionState.selectedSeasonId) || series?.seasons[0] || null;
    const episode = season?.episodes.find((item) => item.id === selectionState.selectedEpisodeId) || season?.episodes[0] || null;

    return {
      groupId: group.id,
      seriesId: series?.id || null,
      seasonId: season?.id || null,
      episodeId: episode?.id || null,
      group,
      series,
      season,
      item: episode
    };
  }

  const item = group.items.find((entry) => entry.id === selectionState.selectedItemId[activeCategory]) || group.items[0] || null;
  return {
    groupId: group.id,
    itemId: item?.id || null,
    group,
    series: null,
    season: null,
    item
  };
}

function getEpisodeNeighbors(season, episodeId, activeCategory) {
  if (activeCategory !== "series" || !season) {
    return { previous: null, next: null };
  }

  const currentIndex = season.episodes.findIndex((episode) => episode.id === episodeId);
  if (currentIndex === -1) {
    return { previous: null, next: null };
  }

  return {
    previous: season.episodes[currentIndex - 1] || null,
    next: season.episodes[currentIndex + 1] || null
  };
}

function buildBreadcrumbs(item, activeCategory) {
  if (!item) {
    return ["Heniz secim yok"];
  }

  if (activeCategory === "series") {
    return [
      labelForCategory(item.contentType),
      item.groupTitle,
      item.seriesName,
      item.seasonName,
      item.episodeLabel
    ].filter(Boolean);
  }

  return [labelForCategory(item.contentType), item.groupTitle, item.name].filter(Boolean);
}

function serializeHistoryItem(item) {
  return {
    url: item.url,
    name: item.name,
    title: item.title || item.name,
    groupTitle: item.groupTitle,
    contentType: item.contentType,
    seriesName: item.seriesName || "",
    seasonName: item.seasonName || "",
    episodeLabel: item.episodeLabel || "",
    logo: item.logo || "",
    playedAt: Date.now()
  };
}

function prefersNativePlayback(url) {
  return /\.(mp4|m4v|webm|ogg|ogv|mp3|aac|m3u8)(\?.*)?$/i.test(url);
}

function findItemLocationByUrl(playlist, url) {
  if (!playlist || !url) {
    return null;
  }

  for (const categoryName of ["live", "movies"]) {
    for (const group of playlist.categories[categoryName].groups) {
      const item = group.items.find((entry) => entry.url === url);
      if (item) {
        return { category: categoryName, groupId: group.id, itemId: item.id };
      }
    }
  }

  for (const group of playlist.categories.series.groups) {
    for (const series of group.series) {
      for (const season of series.seasons) {
        const episode = season.episodes.find((entry) => entry.url === url);
        if (episode) {
          return {
            category: "series",
            groupId: group.id,
            seriesId: series.id,
            seasonId: season.id,
            episodeId: episode.id
          };
        }
      }
    }
  }

  return null;
}

function getAvatarSource(imageUrl) {
  if (!imageUrl) {
    return undefined;
  }

  return (
    <img
      src={imageUrl}
      alt=""
      referrerPolicy="no-referrer"
      onError={(event) => {
        event.currentTarget.style.display = "none";
      }}
    />
  );
}

function buildGlobalSearchResults(playlist, needle, favorites, history, positions) {
  if (!playlist || !needle) {
    return [];
  }

  const sections = [];
  const allResults = [];

  for (const [categoryName, category] of Object.entries(playlist.categories || {})) {
    for (const group of category.groups || []) {
      if (matchesSearch(group.name, needle)) {
        allResults.push({
          key: `group-${categoryName}-${group.id}`,
          kind: "group",
          title: group.name,
          subtitle: `${labelForCategory(categoryName)} / Grup`,
          meta: categoryName === "series"
            ? `${group.seriesCount} seri / ${group.episodeCount} bolum`
            : `${group.items.length} icerik`,
          category: categoryName,
          groupId: group.id
        });
      }

      if (categoryName === "series") {
        for (const series of group.series || []) {
          if (matchesSearch(series, needle)) {
            allResults.push({
              key: `series-${series.id}`,
              kind: "series",
              title: series.name,
              subtitle: `${group.name} / Dizi`,
              meta: `${series.seasonCount} sezon / ${series.episodeCount} bolum`,
              category: "series",
              groupId: group.id,
              seriesId: series.id,
              seasonId: series.seasons[0]?.id || null,
              episodeId: series.seasons[0]?.episodes?.[0]?.id || null,
              image: series.logo
            });
          }

          for (const season of series.seasons || []) {
            if (matchesSearch(season.name, needle)) {
              allResults.push({
                key: `season-${season.id}`,
                kind: "season",
                title: `${series.name} / ${season.name}`,
                subtitle: `${group.name} / Sezon`,
                meta: `${season.episodeCount} bolum`,
                category: "series",
                groupId: group.id,
                seriesId: series.id,
                seasonId: season.id,
                episodeId: season.episodes[0]?.id || null,
                image: series.logo
              });
            }

            for (const episode of season.episodes || []) {
              if (matchesSearch(episode, needle)) {
                allResults.push({
                  key: `episode-${episode.id}`,
                  kind: "episode",
                  title: `${series.name} / ${episode.episodeLabel}`,
                  subtitle: `${group.name} / ${season.name}`,
                  meta: episode.name,
                  category: "series",
                  groupId: group.id,
                  seriesId: series.id,
                  seasonId: season.id,
                  episodeId: episode.id,
                  url: episode.url,
                  image: episode.logo || series.logo
                });
              }
            }
          }
        }
      } else {
        for (const item of group.items || []) {
          if (matchesSearch(item, needle)) {
            allResults.push({
              key: `item-${item.id}`,
              kind: "item",
              title: item.name,
              subtitle: `${group.name} / ${labelForCategory(categoryName)}`,
              meta: item.title || item.groupTitle,
              category: categoryName,
              groupId: group.id,
              itemId: item.id,
              url: item.url,
              image: item.logo
            });
          }
        }
      }
    }
  }

  const favoriteResults = favorites
    .filter((entry) => matchesSearch(entry, needle))
    .map((entry) => ({
      key: `favorite-${entry.url}`,
      kind: "favorite",
      title: entry.seriesName || entry.name,
      subtitle: `Favori / ${labelForCategory(entry.contentType)}`,
      meta: entry.episodeLabel || entry.title || entry.groupTitle,
      url: entry.url,
      image: entry.logo
    }));

  const historyResults = history
    .filter((entry) => matchesSearch(entry, needle))
    .map((entry) => ({
      key: `history-${entry.url}-${entry.playedAt}`,
      kind: "history",
      title: entry.seriesName || entry.name,
      subtitle: `Son izlenen / ${labelForCategory(entry.contentType)}`,
      meta: positions[entry.url]?.time
        ? `${entry.episodeLabel || entry.title || entry.groupTitle} • ${formatTimestamp(positions[entry.url].time)}`
        : (entry.episodeLabel || entry.title || entry.groupTitle),
      url: entry.url,
      image: entry.logo
    }));

  if (allResults.length > 0) {
    sections.push({ key: "playlist", title: "Playlist", results: allResults.slice(0, 80) });
  }

  if (favoriteResults.length > 0) {
    sections.push({ key: "favorites", title: "Favoriler", results: favoriteResults.slice(0, 20) });
  }

  if (historyResults.length > 0) {
    sections.push({ key: "history", title: "Son izlenenler", results: historyResults.slice(0, 20) });
  }

  return sections;
}

function filterGroupsByName(groups, needle) {
  if (!needle) {
    return groups;
  }

  return groups.filter((group) => matchesSearch(group.name, needle));
}

function filterEntries(entries, needle) {
  if (!needle) {
    return entries;
  }

  return entries.filter((entry) => matchesSearch(entry, needle));
}

function normalizeEpgKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/^tr:\s*/i, "")
    .replace(/\b(hd|hq|fhd|uhd|4k)\b/g, " ")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
}

function formatProgrammeTime(value) {
  if (!value) {
    return "";
  }

  return new Date(value).toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatProgrammeWindow(programme) {
  if (!programme?.start || !programme?.stop) {
    return "";
  }

  return `${formatProgrammeTime(programme.start)} - ${formatProgrammeTime(programme.stop)}`;
}

function findLiveProgramme(epgData, item) {
  if (!epgData?.lookup || !item) {
    return null;
  }

  const candidates = [
    item.tvgId,
    item.tvgName,
    item.name,
    item.title
  ];

  for (const candidate of candidates) {
    const key = normalizeEpgKey(candidate);
    if (key && epgData.lookup[key]) {
      return epgData.lookup[key];
    }
  }

  return null;
}

function App() {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const positionsRef = useRef(readStoredJson(STORAGE_KEYS.positions, {}));

  const [playlistSource, setPlaylistSource] = useState(() => localStorage.getItem(STORAGE_KEYS.source) || "");
  const [epgSource, setEpgSource] = useState(() => localStorage.getItem(STORAGE_KEYS.epgSource) || "");
  const [playlist, setPlaylist] = useState(null);
  const [epgData, setEpgData] = useState(null);
  const [activeCategory, setActiveCategory] = useState("live");
  const [globalSearchQuery, setGlobalSearchQuery] = useState("");
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("");
  const [groupSearchQuery, setGroupSearchQuery] = useState("");
  const [contentSearchQuery, setContentSearchQuery] = useState("");
  const [episodeSearchQuery, setEpisodeSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isEpgLoading, setIsEpgLoading] = useState(false);
  const [status, setStatus] = useState({ message: "Playlist bekleniyor", error: false });
  const [history, setHistory] = useState(() => readStoredJson(STORAGE_KEYS.history, []));
  const [favorites, setFavorites] = useState(() => readStoredJson(STORAGE_KEYS.favorites, []));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [selectionState, setSelectionState] = useState(() => defaultSelectionState(null));

  const normalizedGlobalSearch = useMemo(() => normalize(globalSearchQuery.trim()), [globalSearchQuery]);
  const normalizedSidebarSearch = useMemo(() => normalize(sidebarSearchQuery.trim()), [sidebarSearchQuery]);
  const normalizedGroupSearch = useMemo(() => normalize(groupSearchQuery.trim()), [groupSearchQuery]);
  const normalizedContentSearch = useMemo(() => normalize(contentSearchQuery.trim()), [contentSearchQuery]);
  const normalizedEpisodeSearch = useMemo(() => normalize(episodeSearchQuery.trim()), [episodeSearchQuery]);
  const rawGroups = useMemo(
    () => getVisibleGroups(playlist, activeCategory, ""),
    [playlist, activeCategory]
  );
  const visibleGroups = useMemo(
    () => filterGroupsByName(rawGroups, normalizedGroupSearch),
    [rawGroups, normalizedGroupSearch]
  );
  const globalSearchSections = useMemo(
    () => buildGlobalSearchResults(playlist, normalizedGlobalSearch, favorites, history, positionsRef.current),
    [playlist, normalizedGlobalSearch, favorites, history]
  );
  const resolved = useMemo(
    () => resolveSelection(visibleGroups, activeCategory, selectionState),
    [visibleGroups, activeCategory, selectionState]
  );
  const breadcrumbs = useMemo(
    () => buildBreadcrumbs(resolved.item, activeCategory),
    [resolved.item, activeCategory]
  );
  const neighbors = useMemo(
    () => getEpisodeNeighbors(resolved.season, resolved.episodeId, activeCategory),
    [resolved.season, resolved.episodeId, activeCategory]
  );
  const isFavorite = useMemo(
    () => Boolean(resolved.item && favorites.some((entry) => entry.url === resolved.item.url)),
    [favorites, resolved.item]
  );
  const filteredSidebarFavorites = useMemo(
    () => filterEntries(favorites, normalizedSidebarSearch),
    [favorites, normalizedSidebarSearch]
  );
  const filteredSidebarHistory = useMemo(
    () => filterEntries(history, normalizedSidebarSearch),
    [history, normalizedSidebarSearch]
  );
  const filteredContentEntries = useMemo(() => {
    if (!resolved.group) {
      return [];
    }

    return activeCategory === "series"
      ? filterEntries(resolved.group.series || [], normalizedContentSearch)
      : filterEntries(resolved.group.items || [], normalizedContentSearch);
  }, [resolved.group, activeCategory, normalizedContentSearch]);
  const filteredEpisodes = useMemo(
    () => filterEntries(resolved.season?.episodes || [], normalizedEpisodeSearch),
    [resolved.season, normalizedEpisodeSearch]
  );
  const resolvedLiveProgramme = useMemo(
    () => (activeCategory === "live" ? findLiveProgramme(epgData, resolved.item) : null),
    [activeCategory, epgData, resolved.item]
  );

  const setStatusMessage = useCallback((message, error = false) => {
    setStatus({ message, error });
  }, []);

  const updateHistory = useCallback((item) => {
    const entry = serializeHistoryItem(item);
    setHistory((previous) => {
      const next = [entry, ...previous.filter((historyItem) => historyItem.url !== entry.url)].slice(0, MAX_HISTORY_ITEMS);
      writeStoredJson(STORAGE_KEYS.history, next);
      return next;
    });
  }, []);

  const toggleFavorite = useCallback((item) => {
    if (!item) {
      return;
    }

    const exists = favorites.some((favorite) => favorite.url === item.url);
    const entry = serializeHistoryItem(item);
    setFavorites((previous) => {
      const next = exists
        ? previous.filter((favorite) => favorite.url !== entry.url)
        : [entry, ...previous.filter((favorite) => favorite.url !== entry.url)];
      writeStoredJson(STORAGE_KEYS.favorites, next);
      return next;
    });
    setStatusMessage(exists ? "Favorilerden kaldirildi." : "Favorilere eklendi.");
  }, [favorites, setStatusMessage]);

  const destroyPlayer = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.pause();
      playerRef.current.unload();
      playerRef.current.detachMediaElement();
      playerRef.current.destroy();
      playerRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }
  }, []);

  const safePlay = useCallback(async () => {
    try {
      await videoRef.current?.play();
    } catch {}
  }, []);

  const savePlaybackPosition = useCallback((url, time) => {
    if (!url || !Number.isFinite(time) || time < 1) {
      return;
    }

    positionsRef.current = {
      ...positionsRef.current,
      [url]: {
        time,
        updatedAt: Date.now()
      }
    };
    writeStoredJson(STORAGE_KEYS.positions, positionsRef.current);
  }, []);

  const loadEpg = useCallback(async (source, { silent = false } = {}) => {
    const normalizedSource = String(source || "").trim();
    if (!normalizedSource) {
      localStorage.removeItem(STORAGE_KEYS.epgSource);
      setEpgSource("");
      setEpgData(null);
      return null;
    }

    setIsEpgLoading(true);

    try {
      const loadedEpg = await window.iptv.loadEpg(normalizedSource);
      localStorage.setItem(STORAGE_KEYS.epgSource, normalizedSource);
      setEpgSource(normalizedSource);
      setEpgData(loadedEpg);
      return loadedEpg;
    } catch (error) {
      if (!silent) {
        setStatusMessage(error.message || "EPG yuklenemedi.", true);
      }
      return null;
    } finally {
      setIsEpgLoading(false);
    }
  }, [setStatusMessage]);

  const clearPlaybackPosition = useCallback((url) => {
    if (!url || !positionsRef.current[url]) {
      return;
    }

    const next = { ...positionsRef.current };
    delete next[url];
    positionsRef.current = next;
    writeStoredJson(STORAGE_KEYS.positions, next);
  }, []);

  const restorePlaybackPosition = useCallback(async (item) => {
    if (!videoRef.current || !item || item.contentType === "live") {
      return false;
    }

    const savedTime = positionsRef.current[item.url]?.time;
    if (!Number.isFinite(savedTime) || savedTime < 5) {
      return false;
    }

    const video = videoRef.current;
    if (video.readyState < 1) {
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          video.removeEventListener("loadedmetadata", finish);
          resolve();
        };

        video.addEventListener("loadedmetadata", finish, { once: true });
        window.setTimeout(finish, 3000);
      });
    }

    try {
      video.currentTime = savedTime;
      setStatusMessage(`${item.seriesName || item.name} ${formatTimestamp(savedTime)} noktasindan devam ediyor.`);
      return true;
    } catch {
      return false;
    }
  }, [setStatusMessage]);

  const loadPlaylist = useCallback(async (source) => {
    const normalizedSource = String(source || "").trim();
    if (!normalizedSource) {
      setStatusMessage("Playlist adresi gerekli.", true);
      return null;
    }

    setIsLoading(true);
    setStatusMessage("Playlist yukleniyor...");

    try {
      const loadedPlaylist = await window.iptv.loadPlaylist(normalizedSource);
      const nextEpgSource = String(epgSource || loadedPlaylist.suggestedEpgSource || "").trim();
      localStorage.setItem(STORAGE_KEYS.source, normalizedSource);
      setPlaylistSource(normalizedSource);
      setPlaylist(loadedPlaylist);
      if (!epgSource && loadedPlaylist.suggestedEpgSource) {
        localStorage.setItem(STORAGE_KEYS.epgSource, loadedPlaylist.suggestedEpgSource);
        setEpgSource(loadedPlaylist.suggestedEpgSource);
      }
      setGlobalSearchQuery("");
      setSidebarSearchQuery("");
      setGroupSearchQuery("");
      setContentSearchQuery("");
      setEpisodeSearchQuery("");
      setSelectionState(defaultSelectionState(loadedPlaylist));
      if (nextEpgSource) {
        await loadEpg(nextEpgSource, { silent: true });
      } else {
        setEpgData(null);
      }
      setStatusMessage("Playlist yuklendi.");
      return loadedPlaylist;
    } catch (error) {
      destroyPlayer();
      setStatusMessage(error.message || "Playlist yuklenemedi.", true);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [destroyPlayer, epgSource, loadEpg, setStatusMessage]);

  const openLocalPlaylistFile = useCallback(async () => {
    const filePath = await window.iptv.pickLocalFile();
    if (!filePath) {
      return;
    }

    setPlaylistSource(filePath);
    await loadPlaylist(filePath);
  }, [loadPlaylist]);

  const openLocalEpgFile = useCallback(async () => {
    const filePath = await window.iptv.pickEpgFile();
    if (!filePath) {
      return;
    }

    setEpgSource(filePath);
    await loadEpg(filePath);
  }, [loadEpg]);

  const resumeHistoryEntry = useCallback(async (entry) => {
    if (!entry) {
      return;
    }

    let activePlaylist = playlist;
    if (!activePlaylist) {
      const savedSource = localStorage.getItem(STORAGE_KEYS.source) || "";
      if (!savedSource) {
        setStatusMessage("Devam etmek icin once playlist yuklenmeli.", true);
        return;
      }

      activePlaylist = await loadPlaylist(savedSource);
      if (!activePlaylist) {
        return;
      }
    }

    const location = findItemLocationByUrl(activePlaylist, entry.url);
    if (!location) {
      setStatusMessage("Bu kayit mevcut playlistte bulunamadi.", true);
      return;
    }

    setActiveCategory(location.category);
    setSelectionState((previous) => ({
      ...previous,
      selectedGroupId: {
        ...previous.selectedGroupId,
        [location.category]: location.groupId
      },
      selectedItemId: location.category === "series" ? previous.selectedItemId : {
        ...previous.selectedItemId,
        [location.category]: location.itemId
      },
      selectedSeriesId: location.seriesId || previous.selectedSeriesId,
      selectedSeasonId: location.seasonId || previous.selectedSeasonId,
      selectedEpisodeId: location.episodeId || previous.selectedEpisodeId
    }));
  }, [loadPlaylist, playlist, setStatusMessage]);

  const moveEpisode = useCallback((offset) => {
    if (!resolved.season) {
      return;
    }

    const currentIndex = resolved.season.episodes.findIndex((episode) => episode.id === resolved.episodeId);
    if (currentIndex === -1) {
      return;
    }

    const target = resolved.season.episodes[currentIndex + offset];
    if (!target) {
      return;
    }

    setSelectionState((previous) => ({
      ...previous,
      selectedEpisodeId: target.id
    }));
  }, [resolved.episodeId, resolved.season]);

  const applyLocationSelection = useCallback((location) => {
    if (!location?.category) {
      return;
    }

    setActiveCategory(location.category);
    setSelectionState((previous) => ({
      ...previous,
      selectedGroupId: {
        ...previous.selectedGroupId,
        [location.category]: location.groupId || previous.selectedGroupId[location.category]
      },
      selectedItemId: location.category === "series" ? previous.selectedItemId : {
        ...previous.selectedItemId,
        [location.category]: location.itemId || previous.selectedItemId[location.category]
      },
      selectedSeriesId: location.category === "series" ? (location.seriesId || previous.selectedSeriesId) : previous.selectedSeriesId,
      selectedSeasonId: location.category === "series" ? (location.seasonId || previous.selectedSeasonId) : previous.selectedSeasonId,
      selectedEpisodeId: location.category === "series" ? (location.episodeId || previous.selectedEpisodeId) : previous.selectedEpisodeId
    }));
  }, []);

  const openSearchResult = useCallback(async (result) => {
    if (!result) {
      return;
    }

    if (result.url && (result.kind === "favorite" || result.kind === "history")) {
      await resumeHistoryEntry(result);
      setGlobalSearchQuery("");
      return;
    }

    applyLocationSelection(result);
    setGlobalSearchQuery("");
  }, [applyLocationSelection, resumeHistoryEntry]);

  const focusGlobalSearch = useCallback(() => {
    const input = document.getElementById("playlist-search-input");
    input?.focus();
    input?.select?.();
  }, []);

  const clearAllSearches = useCallback(() => {
    setGlobalSearchQuery("");
    setSidebarSearchQuery("");
    setGroupSearchQuery("");
    setContentSearchQuery("");
    setEpisodeSearchQuery("");
  }, []);

  const clearHistory = useCallback(() => {
    writeStoredJson(STORAGE_KEYS.history, []);
    setHistory([]);
  }, []);

  const clearFavorites = useCallback(() => {
    writeStoredJson(STORAGE_KEYS.favorites, []);
    setFavorites([]);
  }, []);

  const clearPlaybackPositions = useCallback(() => {
    positionsRef.current = {};
    writeStoredJson(STORAGE_KEYS.positions, {});
  }, []);

  useEffect(() => {
    if (!playlistSource) {
      return;
    }

    loadPlaylist(playlistSource);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!window.iptv?.onMenuAction) {
      return undefined;
    }

    return window.iptv.onMenuAction(async (action) => {
      switch (action) {
        case "open-local-file":
          await openLocalPlaylistFile();
          break;
        case "open-options":
          setOptionsOpen(true);
          break;
        case "reload-playlist":
          if (playlistSource) {
            await loadPlaylist(playlistSource);
          } else {
            setOptionsOpen(true);
          }
          break;
        case "focus-global-search":
          focusGlobalSearch();
          break;
        case "clear-searches":
          clearAllSearches();
          break;
        case "set-category:live":
          setActiveCategory("live");
          break;
        case "set-category:movies":
          setActiveCategory("movies");
          break;
        case "set-category:series":
          setActiveCategory("series");
          break;
        case "previous-episode":
          moveEpisode(-1);
          break;
        case "next-episode":
          moveEpisode(1);
          break;
        default:
          break;
      }
    });
  }, [clearAllSearches, focusGlobalSearch, loadPlaylist, moveEpisode, openLocalPlaylistFile, playlistSource]);

  useEffect(() => {
    const item = resolved.item;
    if (!item || !videoRef.current) {
      destroyPlayer();
      return undefined;
    }

    let active = true;
    const play = async () => {
      destroyPlayer();
      setStatusMessage(`${labelForCategory(item.contentType)} secili: ${item.seriesName || item.name}`);
      const supportsMse = mpegts?.getFeatureList?.().mseLivePlayback;
      const canUseMpegts = supportsMse && /^https?:\/\//i.test(item.url) && !prefersNativePlayback(item.url);

      if (canUseMpegts) {
        playerRef.current = mpegts.createPlayer({
          type: "mse",
          isLive: item.contentType === "live",
          url: item.url
        });
        playerRef.current.on(mpegts.Events.ERROR, () => {
          if (active) {
            setStatusMessage("mpegts oynatma hatasi olustu. Kaynak bu cihazda desteklenmiyor olabilir.", true);
          }
        });
        playerRef.current.attachMediaElement(videoRef.current);
        playerRef.current.load();
        await restorePlaybackPosition(item);
        await safePlay();
      } else {
        videoRef.current.src = item.url;
        await restorePlaybackPosition(item);
        await safePlay();
      }

      if (active) {
        updateHistory(item);
      }
    };

    play();

    return () => {
      active = false;
      destroyPlayer();
    };
  }, [resolved.item?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const item = resolved.item;
    const video = videoRef.current;

    if (!video || !item || item.contentType === "live") {
      return undefined;
    }

    let lastSavedTime = 0;
    const persistCurrentTime = () => {
      if (!Number.isFinite(video.currentTime) || video.currentTime < 1) {
        return;
      }

      if (Math.abs(video.currentTime - lastSavedTime) >= 5) {
        lastSavedTime = video.currentTime;
        savePlaybackPosition(item.url, video.currentTime);
      }
    };

    const persistImmediately = () => {
      if (Number.isFinite(video.currentTime) && video.currentTime > 1) {
        lastSavedTime = video.currentTime;
        savePlaybackPosition(item.url, video.currentTime);
      }
    };

    const handleEnded = () => {
      clearPlaybackPosition(item.url);
    };

    video.addEventListener("timeupdate", persistCurrentTime);
    video.addEventListener("pause", persistImmediately);
    video.addEventListener("ended", handleEnded);
    window.addEventListener("beforeunload", persistImmediately);

    return () => {
      persistImmediately();
      video.removeEventListener("timeupdate", persistCurrentTime);
      video.removeEventListener("pause", persistImmediately);
      video.removeEventListener("ended", handleEnded);
      window.removeEventListener("beforeunload", persistImmediately);
    };
  }, [resolved.item?.url, clearPlaybackPosition, savePlaybackPosition]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const target = event.target;
      const isTyping = target instanceof HTMLElement
        && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        focusGlobalSearch();
        return;
      }

      if (event.key === "Escape") {
        clearAllSearches();
      }

      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        moveEpisode(-1);
      }

      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        moveEpisode(1);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [clearAllSearches, focusGlobalSearch, moveEpisode]);

  const handleGroupSelect = (group) => {
    setSelectionState((previous) => ({
      ...previous,
      selectedGroupId: {
        ...previous.selectedGroupId,
        [activeCategory]: group.id
      },
      selectedItemId: activeCategory === "series" ? previous.selectedItemId : {
        ...previous.selectedItemId,
        [activeCategory]: group.items[0]?.id || null
      },
      selectedSeriesId: activeCategory === "series" ? group.series[0]?.id || null : previous.selectedSeriesId,
      selectedSeasonId: activeCategory === "series" ? group.series[0]?.seasons?.[0]?.id || null : previous.selectedSeasonId,
      selectedEpisodeId: activeCategory === "series" ? group.series[0]?.seasons?.[0]?.episodes?.[0]?.id || null : previous.selectedEpisodeId
    }));
  };

  const handleSeriesSelect = (series) => {
    setSelectionState((previous) => ({
      ...previous,
      selectedSeriesId: series.id,
      selectedSeasonId: series.seasons[0]?.id || null,
      selectedEpisodeId: series.seasons[0]?.episodes?.[0]?.id || null
    }));
  };

  const handleSeasonSelect = (season) => {
    setSelectionState((previous) => ({
      ...previous,
      selectedSeasonId: season.id,
      selectedEpisodeId: season.episodes[0]?.id || null
    }));
  };

  const handleItemSelect = (item) => {
    if (activeCategory === "series") {
      setSelectionState((previous) => ({ ...previous, selectedEpisodeId: item.id }));
      return;
    }

    setSelectionState((previous) => ({
      ...previous,
      selectedItemId: {
        ...previous.selectedItemId,
        [activeCategory]: item.id
      }
    }));
  };

  const sidebarContent = (
    <div className="sidebar-shell">
      <div className="brand-block">
        <Text type="secondary">Menu</Text>
        <Title level={4}>Deneme IPTV</Title>
        <Text type="secondary">Favoriler ve son izlenenler.</Text>
      </div>

      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <Button block icon={<SettingOutlined />} onClick={() => {
          setOptionsOpen(true);
          setDrawerOpen(false);
        }}>
          Options
        </Button>
        <Button
          block
          icon={<HistoryOutlined />}
          disabled={history.length === 0 || isLoading}
          onClick={() => {
            resumeHistoryEntry(history[0]);
            setDrawerOpen(false);
          }}
        >
          Devam et
        </Button>
      </Space>

      <Divider style={{ margin: "12px 0" }} />

      <Input
        allowClear
        prefix={<SearchOutlined />}
        placeholder="Menu icinde ara"
        value={sidebarSearchQuery}
        onChange={(event) => setSidebarSearchQuery(event.target.value)}
      />

      <Tabs
        size="small"
        className="sidebar-tabs"
        items={[
          {
            key: "favorites",
            label: `Favoriler (${favorites.length})`,
            children: (
              <ResumeList
                entries={filteredSidebarFavorites}
                emptyText="Bir icerigi favorilere eklediginde burada gorunecek."
                onSelect={(entry) => {
                  resumeHistoryEntry(entry);
                  setDrawerOpen(false);
                }}
              />
            )
          },
          {
            key: "history",
            label: `Son izlenenler (${history.length})`,
            children: (
              <ResumeList
                entries={filteredSidebarHistory}
                emptyText="Bir icerik oynattiginda burada gorunecek."
                onSelect={(entry) => {
                  resumeHistoryEntry(entry);
                  setDrawerOpen(false);
                }}
              />
            )
          }
        ]}
      />
    </div>
  );

  const topMenuItems = {
    file: [
      { key: "open", label: "Open Playlist File", onClick: () => openLocalPlaylistFile() },
      { key: "options", label: "Options", onClick: () => setOptionsOpen(true) },
      { key: "reload", label: "Reload Playlist", onClick: () => (playlistSource ? loadPlaylist(playlistSource) : setOptionsOpen(true)) }
    ],
    view: [
      { key: "live", label: "Canli TV", onClick: () => setActiveCategory("live") },
      { key: "movies", label: "Filmler", onClick: () => setActiveCategory("movies") },
      { key: "series", label: "Diziler", onClick: () => setActiveCategory("series") },
      { key: "clear", label: "Aramalari temizle", onClick: () => clearAllSearches() }
    ],
    playback: [
      { key: "prev", label: "Onceki bolum", onClick: () => moveEpisode(-1) },
      { key: "next", label: "Sonraki bolum", onClick: () => moveEpisode(1) },
      { key: "resume", label: "Devam et", onClick: () => history[0] && resumeHistoryEntry(history[0]) }
    ],
    help: [
      { key: "search", label: "Global arama", onClick: () => focusGlobalSearch() },
      { key: "options-help", label: "Options", onClick: () => setOptionsOpen(true) }
    ]
  };

  return (
    <Layout className="app-shell">
      <Drawer
        title="Deneme IPTV"
        placement="left"
        width={DRAWER_WIDTH}
        onClose={() => setDrawerOpen(false)}
        open={drawerOpen}
        className="mobile-drawer"
      >
        {sidebarContent}
      </Drawer>

      <Sider width={DRAWER_WIDTH} className="desktop-sider">
        {sidebarContent}
      </Sider>

      <Layout className="main-layout">
        <Header className="main-header">
          <Space direction="vertical" size={10} style={{ width: "100%" }}>
            <Flex className="top-menu-row" align="center" gap={4} wrap="wrap">
              {[
                { key: "file", label: "File" },
                { key: "view", label: "View" },
                { key: "playback", label: "Playback" },
                { key: "help", label: "Help" }
              ].map((menuSection) => (
                <Dropdown
                  key={menuSection.key}
                  trigger={["click"]}
                  menu={{
                    items: topMenuItems[menuSection.key].map((item) => ({ key: item.key, label: item.label })),
                    onClick: ({ key }) => topMenuItems[menuSection.key].find((item) => item.key === key)?.onClick()
                  }}
                >
                  <Button type="text" className="top-menu-button">
                    {menuSection.label} <DownOutlined />
                  </Button>
                </Dropdown>
              ))}
            </Flex>

            <Flex justify="space-between" align="center" gap={12} wrap="wrap">
              <Flex align="center" gap={10}>
                <Button className="mobile-menu-button" icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} />
                <div>
                  <Title level={4}>Deneme IPTV</Title>
                  <Text type="secondary">Daha sik, daha yogun masaustu gorunumu.</Text>
                </div>
              </Flex>

              <Flex align="center" gap={8} wrap="wrap">
                <Segmented
                  size="middle"
                  value={activeCategory}
                  onChange={(value) => setActiveCategory(value)}
                  options={Object.entries(CATEGORY_CONFIG).map(([key, config]) => ({
                    value: key,
                    label: (
                      <Space size={4}>
                        {config.icon}
                        <span>{config.shortLabel}</span>
                      </Space>
                    )
                  }))}
                />
                <Input
                  id="playlist-search-input"
                  allowClear
                  prefix={<SearchOutlined />}
                  placeholder="Tum uygulamada ara"
                  value={globalSearchQuery}
                  onChange={(event) => setGlobalSearchQuery(event.target.value)}
                  className="header-search"
                />
                <Button icon={<SettingOutlined />} onClick={() => setOptionsOpen(true)} />
              </Flex>
            </Flex>
          </Space>
        </Header>

        <Content className="main-content">
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {status.error ? (
              <Alert
                showIcon
                type="error"
                message={status.message}
              />
            ) : null}

            {normalizedGlobalSearch ? (
              <Card
                size="small"
                className="search-card"
                title={`Genel arama: "${globalSearchQuery.trim()}"`}
                extra={<Text type="secondary">{globalSearchSections.reduce((sum, section) => sum + section.results.length, 0)} sonuc</Text>}
              >
                {globalSearchSections.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Sonuc bulunamadi" />
                ) : (
                  <div className="search-sections">
                    {globalSearchSections.map((section) => (
                      <div key={section.key} className="search-section">
                        <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
                          <Text strong>{section.title}</Text>
                          <Tag>{section.results.length}</Tag>
                        </Flex>
                        <div className="search-results-list">
                          {section.results.map((result) => (
                            <button
                              key={result.key}
                              type="button"
                              className="search-result-row"
                              onClick={() => openSearchResult(result)}
                            >
                              <Avatar size={30} src={getAvatarSource(result.image)}>
                                {(result.title || "?").slice(0, 1).toUpperCase()}
                              </Avatar>
                              <div className="search-result-copy">
                                <Text strong ellipsis>{result.title}</Text>
                                <Text type="secondary" ellipsis>{result.subtitle}</Text>
                              </div>
                              <Text className="search-result-meta" type="secondary" ellipsis>
                                {result.meta}
                              </Text>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ) : null}

            <div className="content-grid">
              <Card
                size="small"
                className="panel-card"
                title="Gruplar"
                extra={(
                  <Space size={8}>
                    <Text type="secondary">{visibleGroups.length} grup</Text>
                    <Input
                      allowClear
                      size="small"
                      prefix={<SearchOutlined />}
                      placeholder="Gruplarda ara"
                      value={groupSearchQuery}
                      onChange={(event) => setGroupSearchQuery(event.target.value)}
                      className="panel-search-input"
                    />
                  </Space>
                )}
              >
                <Spin spinning={isLoading}>
                  <div className="panel-list">
                    {visibleGroups.length === 0 ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Grup bulunamadi" />
                    ) : visibleGroups.map((group) => (
                      <NavRow
                        key={group.id}
                        selected={resolved.groupId === group.id}
                        title={group.name}
                        subtitle={activeCategory === "series"
                          ? `${group.seriesCount} seri / ${group.episodeCount} bolum`
                          : `${group.items.length} icerik`}
                        avatarText={group.name}
                        onClick={() => handleGroupSelect(group)}
                      />
                    ))}
                  </div>
                </Spin>
              </Card>

              <Card
                size="small"
                className="panel-card"
                title={resolved.group?.name || "Icerikler"}
                extra={
                  <Space size={8}>
                    <Text type="secondary">
                      {activeCategory === "series"
                        ? `${filteredContentEntries.length} seri`
                        : `${filteredContentEntries.length} icerik`}
                    </Text>
                    <Input
                      allowClear
                      size="small"
                      prefix={<SearchOutlined />}
                      placeholder={activeCategory === "series" ? "Dizilerde ara" : "Filmler/kanallarda ara"}
                      value={contentSearchQuery}
                      onChange={(event) => setContentSearchQuery(event.target.value)}
                      className="panel-search-input"
                    />
                  </Space>
                }
              >
                <div className="breadcrumb-wrap">
                  <Breadcrumb items={breadcrumbs.map((crumb) => ({ title: crumb }))} />
                </div>

                <div className="panel-list">
                  {!resolved.group ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Once playlist yukle" />
                  ) : filteredContentEntries.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Bu panelde sonuc bulunamadi" />
                  ) : activeCategory === "series" ? (
                    filteredContentEntries.map((series) => (
                      <NavRow
                        key={series.id}
                        selected={resolved.seriesId === series.id}
                        title={series.name}
                        subtitle={`${series.seasonCount} sezon / ${series.episodeCount} bolum`}
                        avatarText={series.name}
                        avatarSrc={series.logo}
                        onClick={() => handleSeriesSelect(series)}
                      />
                    ))
                  ) : (
                    filteredContentEntries.map((item) => (
                      (() => {
                        const liveProgramme = activeCategory === "live" ? findLiveProgramme(epgData, item) : null;
                        const subtitle = activeCategory === "live"
                          ? (liveProgramme?.current
                            ? `${formatProgrammeWindow(liveProgramme.current)} • ${liveProgramme.current.title}`
                            : (liveProgramme?.next
                              ? `Siradaki: ${formatProgrammeTime(liveProgramme.next.start)} • ${liveProgramme.next.title}`
                              : (item.title || item.groupTitle)))
                          : (item.title || item.groupTitle);

                        return (
                      <NavRow
                        key={item.id}
                        selected={resolved.itemId === item.id}
                        title={item.name}
                        subtitle={subtitle}
                        avatarText={item.name}
                        avatarSrc={item.logo}
                        onClick={() => handleItemSelect(item)}
                      />
                        );
                      })()
                    ))
                  )}
                </div>
              </Card>

              <div className="details-column">
                <Card size="small" className="player-card">
                  <video
                    ref={videoRef}
                    controls
                    autoPlay
                    playsInline
                    className="player-video"
                  />
                  <Flex className="player-meta" gap={8} align="center" wrap="wrap">
                    <Text strong>
                      {resolved.item ? (activeCategory === "series" ? resolved.item.seriesName : resolved.item.name) : "Bir icerik sec"}
                    </Text>
                    {resolved.item ? (
                      <>
                        <Tag>
                          {activeCategory === "series" ? `${resolved.item.groupTitle} - ${resolved.item.seasonName}` : resolved.item.groupTitle}
                        </Tag>
                        {activeCategory === "live" && resolvedLiveProgramme?.current ? (
                          <Tag color="cyan">
                            {formatProgrammeTime(resolvedLiveProgramme.current.start)} • {resolvedLiveProgramme.current.title}
                          </Tag>
                        ) : null}
                      </>
                    ) : (
                      <Text type="secondary">Secili icerik burada oynatilir.</Text>
                    )}
                  </Flex>
                </Card>

                <Card
                  size="small"
                  className="detail-card"
                  title={activeCategory === "series" ? "Secili Bolum" : "Secili Icerik"}
                  extra={
                    <Space size={6}>
                      {resolved.item ? (
                        <Button
                          type="text"
                          danger={isFavorite}
                          icon={isFavorite ? <HeartFilled /> : <HeartOutlined />}
                          onClick={() => toggleFavorite(resolved.item)}
                        />
                      ) : null}
                      <Tag color="blue">{resolved.item ? labelForCategory(resolved.item.contentType) : "Hazir"}</Tag>
                    </Space>
                  }
                >
                  {activeCategory === "series" && (neighbors.previous || neighbors.next) ? (
                    <Space size={8} wrap style={{ marginBottom: 12 }}>
                      <Button
                        icon={<StepBackwardOutlined />}
                        disabled={!neighbors.previous}
                        onClick={() => moveEpisode(-1)}
                      >
                        Onceki bolum
                      </Button>
                      <Button
                        icon={<StepForwardOutlined />}
                        disabled={!neighbors.next}
                        onClick={() => moveEpisode(1)}
                      >
                        Sonraki bolum
                      </Button>
                    </Space>
                  ) : null}

                  {activeCategory === "series" && resolved.series ? (
                    <Tabs
                      size="small"
                      activeKey={resolved.seasonId || undefined}
                      onChange={(seasonId) => {
                        const nextSeason = resolved.series.seasons.find((season) => season.id === seasonId);
                        if (nextSeason) {
                          handleSeasonSelect(nextSeason);
                        }
                      }}
                      items={resolved.series.seasons.map((season) => {
                        const seasonFilteredEpisodes = filterEntries(season.episodes || [], normalizedEpisodeSearch);

                        return {
                          key: season.id,
                          label: `${season.name} (${season.episodeCount})`,
                          children: (
                            <div className="season-grid">
                              <Card size="small" className="episode-panel">
                                <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
                                  <Space size={8}>
                                    <Text strong>Bolumler</Text>
                                    <Tag>{seasonFilteredEpisodes.length} bolum</Tag>
                                  </Space>
                                  <Input
                                    allowClear
                                    size="small"
                                    prefix={<SearchOutlined />}
                                    placeholder="Bolumlerde ara"
                                    value={episodeSearchQuery}
                                    onChange={(event) => setEpisodeSearchQuery(event.target.value)}
                                    className="panel-search-input"
                                  />
                                </Flex>
                                <div className="episode-list">
                                  {seasonFilteredEpisodes.length === 0 ? (
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Bu sezonda sonuc bulunamadi" />
                                  ) : seasonFilteredEpisodes.map((episode) => (
                                    <button
                                      key={episode.id}
                                      type="button"
                                      className={`episode-row ${resolved.episodeId === episode.id ? "is-selected" : ""}`}
                                      onClick={() => handleItemSelect(episode)}
                                    >
                                      <div className="episode-copy">
                                        <Text strong>{episode.episodeLabel}</Text>
                                        <Text type="secondary" ellipsis>{episode.name}</Text>
                                      </div>
                                      <PlayCircleFilled className="episode-play-icon" />
                                    </button>
                                  ))}
                                </div>
                              </Card>

                              <Card size="small" className="meta-panel">
                                {!resolved.item ? (
                                  <Text type="secondary">Heniz secili bolum yok.</Text>
                                ) : (
                                  <Space direction="vertical" size={8} style={{ width: "100%" }}>
                                    <InfoRow label="Dizi" value={resolved.series?.name || resolved.item.seriesName} />
                                    <InfoRow label="Sezon" value={resolved.season?.name || resolved.item.seasonName} />
                                    <InfoRow label="Bolum" value={resolved.item.episodeLabel} />
                                    <InfoRow label="Grup" value={resolved.item.groupTitle} />
                                    <InfoRow label="Kaynak" value={resolved.item.url} multiline />
                                  </Space>
                                )}
                              </Card>
                            </div>
                          )
                        };
                      })}
                    />
                  ) : (
                    <Space direction="vertical" size={8} style={{ width: "100%" }}>
                      {!resolved.item ? (
                        <Text type="secondary">Heniz secili icerik yok.</Text>
                      ) : activeCategory === "live" ? (
                        <>
                          <InfoRow label="Kanal" value={resolved.item.title || resolved.item.name} />
                          <InfoRow label="Grup" value={resolved.item.groupTitle} />
                          <InfoRow
                            label="Simdi"
                            value={resolvedLiveProgramme?.current
                              ? `${formatProgrammeWindow(resolvedLiveProgramme.current)} • ${resolvedLiveProgramme.current.title}`
                              : "EPG bilgisi bulunamadi"}
                            multiline
                          />
                          <InfoRow
                            label="Siradaki"
                            value={resolvedLiveProgramme?.next
                              ? `${formatProgrammeWindow(resolvedLiveProgramme.next)} • ${resolvedLiveProgramme.next.title}`
                              : "Siradaki yayin bilgisi yok"}
                            multiline
                          />
                          <InfoRow label="Kaynak" value={resolved.item.url} multiline />
                        </>
                      ) : (
                        <>
                          <InfoRow label="Baslik" value={resolved.item.title || resolved.item.name} />
                          <InfoRow label="Grup" value={resolved.item.groupTitle} />
                          <InfoRow label="Kaynak" value={resolved.item.url} multiline />
                        </>
                      )}
                    </Space>
                  )}
                </Card>
              </div>
            </div>
          </Space>
        </Content>
        <Footer className="main-footer">
          <Flex justify="space-between" align="center" gap={12} wrap="wrap">
            <Text type="secondary">
              {labelForCategory(activeCategory)} / {resolved.item ? (resolved.item.seriesName || resolved.item.name) : "Hazir"}
              {activeCategory === "live" && resolvedLiveProgramme?.current ? ` / ${resolvedLiveProgramme.current.title}` : ""}
            </Text>
            <Text type="secondary" ellipsis className="footer-source">
              {formatSource(playlist?.source || playlistSource)}
            </Text>
          </Flex>
        </Footer>
      </Layout>

      <Modal
        title="Options"
        open={optionsOpen}
        onCancel={() => setOptionsOpen(false)}
        width={880}
        okText="Kaydet ve yukle"
        okButtonProps={{ disabled: !playlistSource || isLoading || isEpgLoading, loading: isLoading || isEpgLoading }}
        onOk={async () => {
          await loadPlaylist(playlistSource);
          await loadEpg(epgSource, { silent: true });
          setOptionsOpen(false);
        }}
        cancelText="Kapat"
      >
        <Tabs
          size="small"
          items={[
            {
              key: "playlist",
              label: "Playlist",
              children: (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Alert
                    type="info"
                    showIcon
                    message="Playlist kaynagini burada yonet. Uzak URL'ler disk cache ile gunde en fazla bir kez yenilenir."
                  />

                  <Card size="small" className="options-card">
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      <div>
                        <Text type="secondary">Kaydedilen kaynak</Text>
                        <div className="source-hint">{formatSource(playlist?.source || playlistSource)}</div>
                      </div>

                      <Input
                        value={playlistSource}
                        onChange={(event) => setPlaylistSource(event.target.value)}
                        placeholder="M3U playlist URL veya dosya yolu"
                        disabled={isLoading}
                      />

                      <Space size={8} wrap>
                        <Button
                          icon={<FolderOpenOutlined />}
                          disabled={isLoading}
                          onClick={async () => {
                            const filePath = await window.iptv.pickLocalFile();
                            if (filePath) {
                              setPlaylistSource(filePath);
                            }
                          }}
                        >
                          Dosya sec
                        </Button>
                        <Button
                          icon={<ReloadOutlined />}
                          disabled={!playlistSource || isLoading}
                          onClick={() => loadPlaylist(playlistSource)}
                        >
                          Simdi yenile
                        </Button>
                      </Space>
                    </Space>
                  </Card>
                </Space>
              )
            },
            {
              key: "epg",
              label: "EPG",
              children: (
                <div className="options-grid">
                  <Card size="small" className="options-card" title="EPG kaynagi">
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      <InfoRow
                        label="Mevcut"
                        value={formatSource(epgData?.source || epgSource || playlist?.suggestedEpgSource || "EPG kaynagi ayarlanmadi")}
                        multiline
                      />
                      <Input
                        value={epgSource}
                        onChange={(event) => setEpgSource(event.target.value)}
                        placeholder="XMLTV / EPG URL veya dosya yolu"
                        disabled={isEpgLoading}
                      />
                      <Space size={8} wrap>
                        <Button
                          icon={<FolderOpenOutlined />}
                          disabled={isEpgLoading}
                          onClick={openLocalEpgFile}
                        >
                          EPG dosyasi sec
                        </Button>
                        <Button
                          icon={<ReloadOutlined />}
                          loading={isEpgLoading}
                          disabled={!epgSource}
                          onClick={() => loadEpg(epgSource)}
                        >
                          EPG yenile
                        </Button>
                      </Space>
                    </Space>
                  </Card>

                  <Card size="small" className="options-card" title="EPG durumu">
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      <InfoRow label="Kanallar" value={String(epgData?.channelCount || 0)} />
                      <InfoRow label="Programlar" value={String(epgData?.programmeCount || 0)} />
                      <InfoRow
                        label="Yuklendi"
                        value={epgData?.loadedAt ? new Date(epgData.loadedAt).toLocaleString("tr-TR") : "Heniz yuklenmedi"}
                      />
                      <InfoRow
                        label="Playlist ipucu"
                        value={playlist?.suggestedEpgSource || "Playlist icinde otomatik EPG linki yok"}
                        multiline
                      />
                    </Space>
                  </Card>
                </div>
              )
            },
            {
              key: "library",
              label: "Kutuphane",
              children: (
                <div className="options-grid">
                  <Card size="small" className="options-card" title="Kayitlar">
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      <InfoRow label="Favoriler" value={`${favorites.length} kayit`} />
                      <InfoRow label="Son izlenenler" value={`${history.length} kayit`} />
                      <InfoRow label="Devam noktasi" value={`${Object.keys(positionsRef.current).length} kayit`} />
                      <Space size={8} wrap>
                        <Button danger onClick={clearFavorites}>
                          Favorileri temizle
                        </Button>
                        <Button danger onClick={clearHistory}>
                          Son izlenenleri temizle
                        </Button>
                        <Button danger onClick={clearPlaybackPositions}>
                          Devam verisini temizle
                        </Button>
                      </Space>
                    </Space>
                  </Card>

                  <Card size="small" className="options-card" title="Playlist ozeti">
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      <InfoRow label="Toplam" value={String(playlist?.counts?.total || 0)} />
                      <InfoRow label="Canli TV" value={String(playlist?.counts?.live || 0)} />
                      <InfoRow label="Filmler" value={String(playlist?.counts?.movies || 0)} />
                      <InfoRow label="Diziler" value={String(playlist?.counts?.seriesTitles || 0)} />
                    </Space>
                  </Card>
                </div>
              )
            },
            {
              key: "playback",
              label: "Oynatma",
              children: (
                <div className="options-grid">
                  <Card size="small" className="options-card" title="Davranis">
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      <InfoRow label="Devam etme" value="Film ve bolumler son izlenen noktadan devam eder." />
                      <InfoRow label="Canli TV" value="Canli yayinlarda konum kaydi tutulmaz." />
                      <InfoRow label="Gecis" value="Alt + Sol / Sag ile onceki ve sonraki bolume gecebilirsin." />
                    </Space>
                  </Card>

                  <Card size="small" className="options-card" title="Hizli islemler">
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      <Button onClick={clearAllSearches}>Tum aramalari temizle</Button>
                      <Button disabled={!history[0]} onClick={() => history[0] && resumeHistoryEntry(history[0])}>
                        Son izlenene devam et
                      </Button>
                    </Space>
                  </Card>
                </div>
              )
            },
            {
              key: "about",
              label: "Uygulama",
              children: (
                <div className="options-grid">
                  <Card size="small" className="options-card" title="Deneme IPTV">
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      <InfoRow label="UI" value="React + Ant Design" />
                      <InfoRow label="Player" value="mpegts.js + HTML5 video" />
                      <InfoRow label="Release" value="electron-builder ile macOS / Linux / Windows paketleri" />
                    </Space>
                  </Card>

                  <Card size="small" className="options-card" title="Kisayollar">
                    <Space direction="vertical" size={10} style={{ width: "100%" }}>
                      <InfoRow label="/" value="Global arama" />
                      <InfoRow label="Esc" value="Tum aramalari temizle" />
                      <InfoRow label="Alt + Sol/Sag" value="Bolum gecisi" />
                    </Space>
                  </Card>
                </div>
              )
            }
          ]}
        />
      </Modal>
    </Layout>
  );
}

function ResumeList({ entries, emptyText, onSelect }) {
  if (entries.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />;
  }

  return (
    <div className="resume-list">
      {entries.map((entry, index) => (
        <button
          key={`${entry.url}-${entry.playedAt || index}`}
          type="button"
          className="nav-row"
          onClick={() => onSelect(entry)}
        >
          <Avatar size={34} src={getAvatarSource(entry.logo)}>
            {(entry.seriesName || entry.name || "?").slice(0, 1).toUpperCase()}
          </Avatar>
          <div className="nav-row-copy">
            <Text strong ellipsis>{entry.seriesName || entry.name}</Text>
            <Text type="secondary" ellipsis>{entry.episodeLabel || entry.title}</Text>
          </div>
        </button>
      ))}
    </div>
  );
}

function NavRow({ selected, title, subtitle, avatarText, avatarSrc, onClick }) {
  return (
    <button type="button" className={`nav-row ${selected ? "is-selected" : ""}`} onClick={onClick}>
      <Avatar size={34} src={getAvatarSource(avatarSrc)}>
        {(avatarText || "?").slice(0, 1).toUpperCase()}
      </Avatar>
      <div className="nav-row-copy">
        <Text strong ellipsis>{title}</Text>
        <Text type="secondary" ellipsis>{subtitle}</Text>
      </div>
    </button>
  );
}

function InfoRow({ label, value, multiline = false }) {
  return (
    <div className={`info-row ${multiline ? "is-multiline" : ""}`}>
      <Text type="secondary">{label}</Text>
      <Text className="info-value" ellipsis={!multiline}>
        {value}
      </Text>
    </div>
  );
}

export default App;
