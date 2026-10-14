import { registry } from "./registry";
import type { ModuleProps } from "./moduleProps";
export function ModuleBody(props: ModuleProps) {
  const Component = registry[props.mod.type].component;
  return <Component {...props} />;
}
