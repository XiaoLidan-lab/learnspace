import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Workspace, Note } from "./model";
import { cloudPayload, payloadHash } from "./cloudData";
import { saveCloud } from "./cloudService";
export function useCloudSync(
  client: SupabaseClient | null,
  userId: string | undefined,
  ready: boolean,
  workspaces: Workspace[],
  notes: Note[],
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>,
) {
  const [status, setStatus] = useState<Record<string, string>>({});
  const [retry, setRetry] = useState(0);
  const running = useRef(false),
    failures = useRef(new Map<string, string>());
  const latest = useRef({ workspaces, notes });
  latest.current = { workspaces, notes };
  const generation = useRef(0),
    controller = useRef<AbortController>();
  useEffect(() => {
    generation.current++;
    controller.current?.abort();
    running.current = false;
    failures.current.clear();
    setStatus({});
    return () => {
      generation.current++;
      controller.current?.abort();
    };
  }, [userId]);
  useEffect(() => {
    if (!client || !userId || !ready) return;
    const token = generation.current;
    const timer = setTimeout(async () => {
      if (running.current || token !== generation.current) return;
      running.current = true;
      const abort = new AbortController();
      controller.current = abort;
      let pending = false;
      try {
        for (const w of latest.current.workspaces) {
          if (w.cloud?.ownerId !== userId || token !== generation.current)
            continue;
          // Stop before hashing too: preserve conflict feedback until explicit retry.
          if (failures.current.has(w.id)) continue;
          let attemptedHash = "invalid";
          try {
            const payload = cloudPayload(w, latest.current.notes),
              hash = await payloadHash(payload);
            attemptedHash = hash;
            if (token !== generation.current) break;
            if (hash === w.cloud.syncedHash) {
              setStatus((s) => ({ ...s, [w.id]: "已同步" }));
              continue;
            }
            setStatus((s) => ({ ...s, [w.id]: "正在同步…" }));
            const revision = await saveCloud(
              client,
              w.id,
              w.cloud.revision,
              payload,
              abort.signal,
            );
            if (token !== generation.current) break;
            setWorkspaces((ws) =>
              ws.map((x) =>
                x.id === w.id && x.cloud?.ownerId === userId
                  ? {
                      ...x,
                      cloud: {
                        ownerId: userId,
                        revision,
                        syncedHash: hash,
                        syncedAt: Date.now(),
                      },
                    }
                  : x,
              ),
            );
            const latestWorkspace = latest.current.workspaces.find(
              (x) => x.id === w.id,
            );
            const newer =
              latestWorkspace &&
              (await payloadHash(
                cloudPayload(latestWorkspace, latest.current.notes),
              )) !== hash;
            pending ||= !!newer;
            setStatus((s) => ({
              ...s,
              [w.id]: newer ? "待同步（已有新修改）" : "已同步",
            }));
            failures.current.delete(w.id);
          } catch (e) {
            if (token !== generation.current) break;
            // No automatic retries for conflicts or failed uploads; local edits remain available.
            failures.current.set(w.id, attemptedHash);
            setStatus((s) => ({
              ...s,
              [w.id]: e instanceof Error ? e.message : "同步失败",
            }));
          }
        }
      } finally {
        if (token === generation.current) {
          running.current = false;
          if (pending) setRetry((n) => n + 1);
        }
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [client, userId, ready, workspaces, notes, retry]);
  return {
    status,
    retry: (workspaceId?: string) => {
      if (workspaceId) failures.current.delete(workspaceId);
      else failures.current.clear();
      setRetry((n) => n + 1);
    },
  };
}
