// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskProof, taskPhotosProblem } from "./task-photo";

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRequestTaskPhotoUploadUrl: () => ({ mutateAsync: vi.fn() }),
  // The signed link is still loading: a stored photo draws its placeholder.
  useTaskPhotoUrl: () => ({ data: undefined }),
}));

const photos = [
  { id: "ph-ref", kind: "reference" as const, storage_path: "t/ref.jpg" },
  { id: "ph-proof-1", kind: "proof" as const, storage_path: "t/p1.jpg" },
  { id: "ph-proof-2", kind: "proof" as const, storage_path: "t/p2.jpg" },
];

describe("TaskProof (#4635)", () => {
  it("shows the sent-back reason while the task waits on its change", () => {
    render(
      <TaskProof
        task={{ id: "t-1", sent_back_reason: "The floor is still sticky" }}
        showProof
        sentBack
      />,
    );
    expect(screen.getByText("Sent back:")).toBeInTheDocument();
    expect(screen.getByText("The floor is still sticky")).toBeInTheDocument();
  });

  it("drops a stale reason once nothing is waiting on it and there is no reply", () => {
    const { container } = render(
      <TaskProof
        task={{ id: "t-1", sent_back_reason: "The floor is still sticky" }}
        showProof
        sentBack={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the reason beside the assignee's reply once marked done again", () => {
    render(
      <TaskProof
        task={{
          id: "t-1",
          sent_back_reason: "The floor is still sticky",
          completion_note: "Mopped it twice",
        }}
        showProof
      />,
    );
    expect(screen.getByText("The floor is still sticky")).toBeInTheDocument();
    expect(screen.getByText("Reply:")).toBeInTheDocument();
    expect(screen.getByText("Mopped it twice")).toBeInTheDocument();
  });

  it("shows a proof link as a chip of its domain that opens in a new tab", () => {
    render(
      <TaskProof
        task={{
          id: "t-1",
          proof_link: "https://www.docs.google.com/document/d/abc?x=1",
        }}
        showProof
      />,
    );
    const chip = screen.getByRole("link", {
      name: "Proof link: docs.google.com, opens in a new tab",
    });
    expect(chip).toHaveAttribute(
      "href",
      "https://www.docs.google.com/document/d/abc?x=1",
    );
    expect(chip).toHaveAttribute("target", "_blank");
    expect(chip).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(chip).toHaveTextContent("docs.google.com");
  });

  it("splits reference photos from proof, each a button to view full size", () => {
    render(<TaskProof task={{ id: "t-1", photos }} showProof />);
    expect(
      screen.getByRole("button", {
        name: "Photos, photo 1 of 1, opens full size",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Proof, photo 2 of 2, opens full size",
      }),
    ).toBeInTheDocument();
  });

  it("keeps proof, link, reason and reply from a viewer it isn't for", () => {
    render(
      <TaskProof
        task={{
          id: "t-1",
          photos,
          proof_link: "https://example.com/recap",
          sent_back_reason: "Redo it",
          completion_note: "Redone",
        }}
        showProof={false}
        sentBack
      />,
    );
    // The reference photos are anyone's to see.
    expect(
      screen.getByRole("button", { name: /^Photos, photo 1 of 1/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Proof,/ })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("Redo it")).toBeNull();
    expect(screen.queryByText("Redone")).toBeNull();
  });
});

describe("taskPhotosProblem", () => {
  const jpeg = (name: string) => new File(["x"], name, { type: "image/jpeg" });

  it("takes up to six photos and refuses a seventh", () => {
    const six = Array.from({ length: 6 }, (_, i) => jpeg(`${i}.jpg`));
    expect(taskPhotosProblem(six)).toBeNull();
    expect(taskPhotosProblem([...six, jpeg("7.jpg")])).toBe("Up to 6 photos.");
  });

  it("counts the photos a task already keeps against the room left", () => {
    expect(taskPhotosProblem([jpeg("a.jpg"), jpeg("b.jpg")], 1)).toBe(
      "Up to 6 photos.",
    );
  });

  it("names a file that isn't a photo", () => {
    expect(
      taskPhotosProblem([
        jpeg("a.jpg"),
        new File(["x"], "slip.pdf", { type: "application/pdf" }),
      ]),
    ).toBe("Use a JPEG, PNG, GIF or WebP photo.");
  });
});
