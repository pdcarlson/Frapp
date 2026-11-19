import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * "How the chapter sees you" on the web (#5627): the same screen as the
 * phone's s03 first screen, then chat.
 */
const mocks = vi.hoisted(() => ({
  user: undefined as Record<string, unknown> | undefined,
  isError: false,
  offline: false,
  updateUser: vi.fn(),
  replace: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useCurrentUser: () => ({
    data: mocks.user,
    isPending: mocks.user === undefined && !mocks.isError,
    isError: mocks.isError,
    refetch: mocks.refetch,
  }),
  useUpdateUser: () => ({ mutateAsync: mocks.updateUser }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: mocks.offline, probeOnce: vi.fn() }),
}));
/** The photo control has its own spec; here it only has to be there. */
vi.mock("@/components/profile/profile-photo-control", () => ({
  ProfilePhotoControl: ({ hasPhoto }: { hasPhoto: boolean }) => (
    <button type="button">{hasPhoto ? "Change photo" : "Add photo"}</button>
  ),
}));

import { WelcomeYou } from "./welcome-you";

const ADA = {
  id: "u-1",
  display_name: "Ada Lovelace",
  email: "ada@example.edu",
  avatar_url: null,
};

const field = () => screen.getByLabelText("Your name") as HTMLInputElement;
const goToChat = () => screen.getByRole("button", { name: "Go to chat" });

describe("WelcomeYou", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user = ADA;
    mocks.isError = false;
    mocks.offline = false;
    mocks.updateUser.mockResolvedValue({});
  });

  it("says the phone's words, with a real name pre-filled and a photo to add", () => {
    render(<WelcomeYou />);

    expect(
      screen.getByRole("heading", { name: "How the chapter sees you" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Your photo and name go on every message you send."),
    ).toBeTruthy();
    expect(field().value).toBe("Ada Lovelace");
    expect(screen.getByRole("button", { name: "Add photo" })).toBeTruthy();
  });

  it("goes to chat without resending a name that didn't change", async () => {
    render(<WelcomeYou />);

    fireEvent.click(goToChat());

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/chat"));
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("starts empty for the email before the @, and needs a name first", async () => {
    mocks.user = { ...ADA, display_name: "ada" };
    render(<WelcomeYou />);

    expect(field().value).toBe("");
    fireEvent.click(goToChat());
    expect(
      await screen.findByText(
        "Add your name so the chapter knows who's talking.",
      ),
    ).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();

    fireEvent.change(field(), { target: { value: "  Ada King " } });
    expect(
      screen.queryByText("Add your name so the chapter knows who's talking."),
    ).toBeNull();
    fireEvent.click(goToChat());

    await waitFor(() =>
      expect(mocks.updateUser).toHaveBeenCalledWith({
        display_name: "Ada King",
      }),
    );
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/chat"));
  });

  it("never pre-fills the Member stand-in", () => {
    mocks.user = { ...ADA, display_name: "Member" };
    render(<WelcomeYou />);

    expect(field().value).toBe("");
  });

  it("stays, with the reason and the name, when the name can't be saved", async () => {
    mocks.updateUser.mockRejectedValueOnce(new Error("offline"));
    render(<WelcomeYou />);
    fireEvent.change(field(), { target: { value: "Ada King" } });

    fireEvent.click(goToChat());

    expect(
      await screen.findByText(
        "Couldn't save your name. Check your connection and try again.",
      ),
    ).toBeTruthy();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(field().value).toBe("Ada King");
    expect((goToChat() as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers a retry when the profile can't be read", () => {
    mocks.user = undefined;
    mocks.isError = true;
    render(<WelcomeYou />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.refetch).toHaveBeenCalled();
  });
});
