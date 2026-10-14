export type Platform = {
  name: string;
  url: string;
  embedUrl?: string;
  capabilities: {
    embed: boolean;
    seek: boolean;
    metadata: boolean;
    subtitles: boolean;
    selection: boolean;
  };
};
export function safeUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error("请使用不含凭证的 HTTP 或 HTTPS 地址");
  return url.href;
}
export function videoAdapter(raw: string, time = 0): Platform {
  const url = new URL(safeUrl(raw));
  const host = url.hostname.toLowerCase();
  const caps = {
    embed: false,
    seek: false,
    metadata: false,
    subtitles: false,
    selection: false,
  };
  const isYouTube = [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
    "youtu.be",
  ].includes(host);
  if (isYouTube) {
    const id =
      host === "youtu.be"
        ? url.pathname.slice(1).split("/")[0]
        : url.searchParams.get("v") ||
          url.pathname.match(/\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
    if (id && /^[a-zA-Z0-9_-]{11}$/.test(id))
      return {
        name: "YouTube",
        url: url.href,
        embedUrl: `https://www.youtube.com/embed/${id}?start=${Math.floor(Math.max(0, time))}`,
        capabilities: { ...caps, embed: true, seek: true },
      };
  }
  if (
    ["www.bilibili.com", "bilibili.com", "player.bilibili.com"].includes(host)
  ) {
    const bvid =
      url.pathname.match(/\/(BV[a-zA-Z0-9]+)/)?.[1] ||
      url.searchParams.get("bvid");
    const aid =
      url.pathname.match(/\/av(\d+)/)?.[1] || url.searchParams.get("aid");
    if ((bvid && /^BV[a-zA-Z0-9]+$/.test(bvid)) || (aid && /^\d+$/.test(aid))) {
      const params = new URLSearchParams({
        autoplay: "0",
        page: url.searchParams.get("p") || "1",
      });
      if (bvid) params.set("bvid", bvid);
      else params.set("aid", aid!);
      return {
        name: "Bilibili",
        url: url.href,
        embedUrl: `https://player.bilibili.com/player.html?${params}`,
        capabilities: { ...caps, embed: true },
      };
    }
  }
  return { name: "外部视频", url: url.href, capabilities: caps };
}
export function webAdapter(raw: string, origin: string): Platform {
  const url = safeUrl(raw);
  return {
    name: "网页",
    url,
    embedUrl: url,
    capabilities: {
      embed: true,
      seek: false,
      metadata: false,
      subtitles: false,
      selection: new URL(url).origin === origin,
    },
  };
}
export const localVideoAdapter = {
  name: "本地视频",
  capabilities: {
    embed: true,
    seek: true,
    metadata: true,
    subtitles: false,
    selection: false,
  },
};
