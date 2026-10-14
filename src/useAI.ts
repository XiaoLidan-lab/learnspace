import { useEffect, useRef, useState } from "react";
import { ai } from "./services";
import { RequestGate } from "./requestGate";
export function useAI(inputKey: string) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const gate = useRef(new RequestGate()),
    active = useRef(true),
    controller = useRef<AbortController>();
  gate.current.invalidate(inputKey);
  useEffect(() => {
    controller.current?.abort();
  }, [inputKey]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      gate.current.cancel();
      controller.current?.abort();
    };
  }, []);
  async function run(
    action: string,
    payload: unknown,
    apply: (result: any) => void,
  ) {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const ticket = gate.current.begin();
    setBusy(true);
    setError("");
    try {
      const result = await ai(action, payload, request.signal);
      if (active.current && gate.current.isCurrent(ticket)) apply(result);
    } catch (e) {
      if (
        active.current &&
        gate.current.isCurrent(ticket) &&
        !request.signal.aborted
      )
        setError(e instanceof Error ? e.message : "请求失败");
    } finally {
      if (active.current && controller.current === request) setBusy(false);
    }
  }
  return { busy, error, run };
}
