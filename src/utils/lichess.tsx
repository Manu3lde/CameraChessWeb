import { Study } from "../types";

const LICHESS_ORIGIN = "https://lichess.org";

const parseNdjson = (body: string): any[] => {
  return body
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
};

const toStudy = (entry: any): Study | null => {
  const id = entry?.id ?? entry?.study?.id;
  const name = entry?.name ?? entry?.study?.name ?? entry?.tour?.name;

  if (typeof id !== "string" || typeof name !== "string") {
    return null;
  }

  return { id, name };
};

export const lichessSetStudies = async (
  token: string,
  setStudies: React.Dispatch<React.SetStateAction<Study[]>>,
  username: string,
  onlyBroadcasts: boolean,
) => {
  if (!username) {
    setStudies([]);
    return;
  }

  const path = onlyBroadcasts
    ? `/api/broadcast/by/${encodeURIComponent(username)}`
    : `/api/study/by/${encodeURIComponent(username)}`;
  const headers: HeadersInit = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  try {
    const response = await fetch(`${LICHESS_ORIGIN}${path}`, { headers });
    if (!response.ok) {
      setStudies([]);
      return;
    }

    const studies = parseNdjson(await response.text())
      .map(toStudy)
      .filter((study): study is Study => study !== null);
    setStudies(studies);
  } catch {
    setStudies([]);
  }
};
