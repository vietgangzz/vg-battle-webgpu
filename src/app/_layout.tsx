import { Stack } from "expo-router/stack";
import { StatusBar } from "expo-status-bar";

export { ErrorBoundary } from "expo-router";

export default function Layout() {
  return (
    <>
      <StatusBar hidden />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#000" } }} />
    </>
  );
}
