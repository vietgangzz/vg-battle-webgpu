import { Stack } from "expo-router/stack";

export { ErrorBoundary } from "expo-router";

export default function Layout() {
  // edge to edge: no header, status bar or home indicator over the film
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        statusBarHidden: true,
        autoHideHomeIndicator: true,
        contentStyle: { backgroundColor: "#000" },
      }}
    />
  );
}
