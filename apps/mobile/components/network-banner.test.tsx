// Override module resolution by mocking expo completely for this test
jest.mock('expo', () => ({}));

import { render } from "@testing-library/react-native";

// Mock the network-banner module to isolate it from native imports
jest.mock("@/lib/theme", () => ({
  useFrappTheme: () => ({
    tokens: {
      color: {
        feedback: {
          errorBackground: "#ffebee",
          errorBorder: "#ef5350",
          warningBackground: "#fff8e1",
          warningBorder: "#ffb300",
          errorText: "#c62828",
          warningText: "#f57f17",
        },
      },
    },
  }),
}));

import { NetworkBanner } from "./network-banner";

describe("NetworkBanner", () => {
  it("renders offline banner correctly", () => {
    const { getByText } = render(
      <NetworkBanner isOnline={false} isInternetReachable={false} />
    );

    expect(
      getByText("You're offline. Showing available data until connection returns.")
    ).toBeTruthy();
  });

  it("renders degraded banner correctly", () => {
    const { getByText } = render(
      <NetworkBanner isOnline={true} isInternetReachable={false} />
    );

    expect(
      getByText("Connection is unstable. Some actions may be delayed.")
    ).toBeTruthy();
  });

  it("renders nothing when online and reachable", () => {
    const { queryByText } = render(
      <NetworkBanner isOnline={true} isInternetReachable={true} />
    );

    expect(
      queryByText("You're offline. Showing available data until connection returns.")
    ).toBeNull();
    expect(
      queryByText("Connection is unstable. Some actions may be delayed.")
    ).toBeNull();
  });
});
