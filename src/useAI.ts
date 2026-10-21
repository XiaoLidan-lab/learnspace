import { useEffect, useRef, useState } from "react";
import { ai } from "./services";
import { RequestGate } from "./requestGate";
export function useAI(inputKey: string) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [partial, setPartial] = useState({ key: inputKey, text: "" });
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
    payload: unknown | ((signal: AbortSignal) => Promise<unknown>),
    apply: (result: any) => void,
  ) {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const ticket = gate.current.begin();
    setPartial({ key: inputKey, text: "" });
    setBusy(true);
    setError("");
    try {
      const prepared =
        typeof payload === "function" ? await payload(request.signal) : payload;
      if (
        !active.current ||
        !gate.current.isCurrent(ticket) ||
        request.signal.aborted
      )
        return;
      const streaming = ["chat", "translate", "quiz"].includes(action);
      const result = await ai(action, prepared, request.signal, streaming ? (text) => {
        if (active.current && gate.current.isCurrent(ticket) && !request.signal.aborted)
          setPartial({ key: inputKey, text });
      } : undefined);
      if (active.current && gate.current.isCurrent(ticket)) {
        apply(result);
        setPartial({ key: inputKey, text: "" });
      }
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
  return {
    busy,
    partial: partial.key === inputKey ? partial.text : "",
    error,
    clearPartial: () => setPartial({ key: inputKey, text: "" }),
    run,
    cancel: () => {
      controller.current?.abort();
      gate.current.cancel();
      setBusy(false);
      setError("");
    },
  };
}
