import { useUi, type Route } from "../stores/ui";

/** Where the header back button goes from Practice or Review, or null when there's nowhere to go back to. */
export function backTarget(route: Route, backRoute: Route | null): Route | null {
  if (route.name === "practice") {
    if (route.topicKey) return { name: "practice", spaceId: route.spaceId };
    return backRoute ?? { name: "space", spaceId: route.spaceId };
  }
  if (route.name === "review") return backRoute ?? (route.spaceId ? { name: "space", spaceId: route.spaceId } : { name: "home" });
  return null;
}

export function goBack(): boolean {
  const { route, backRoute, navigate } = useUi.getState();
  const target = backTarget(route, backRoute);
  if (!target) return false;
  navigate(target);
  return true;
}
