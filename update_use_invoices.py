import re

with open("packages/hooks/src/use-invoices.spec.tsx", "r") as f:
    content = f.read()

# Import useInvoices
content = content.replace(
    'import { useCreateInvoice } from "./use-invoices";',
    'import { useCreateInvoice, useInvoices } from "./use-invoices";'
)

new_describe = """
describe("useInvoices", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  const createWrapper = (mockClient: unknown) => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={
          mockClient as unknown as ReturnType<typeof createFrappClient>
        }
      >
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </FrappClientProvider>
    );

    Wrapper.displayName = "UseInvoicesTestWrapper";
    return Wrapper;
  };

  it("fetches all invoices when no userId is provided", async () => {
    const mockInvoices = [
      { id: "inv-1", title: "Invoice 1", amount: 100 },
      { id: "inv-2", title: "Invoice 2", amount: 200 },
    ];
    const mockGet = vi.fn().mockResolvedValue({
      data: mockInvoices,
      error: null,
    });
    const mockClient = { GET: mockGet };

    const { result } = renderHook(() => useInvoices(), {
      wrapper: createWrapper(mockClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/invoices", {
      params: { query: { user_id: undefined } },
    });
    expect(result.current.data).toEqual(mockInvoices);
  });

  it("fetches invoices for specific user when userId is provided", async () => {
    const mockInvoices = [
      { id: "inv-3", title: "User Invoice", amount: 300 },
    ];
    const mockGet = vi.fn().mockResolvedValue({
      data: mockInvoices,
      error: null,
    });
    const mockClient = { GET: mockGet };
    const userId = "user-123";

    const { result } = renderHook(() => useInvoices(userId), {
      wrapper: createWrapper(mockClient),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/invoices", {
      params: { query: { user_id: userId } },
    });
    expect(result.current.data).toEqual(mockInvoices);
  });

  it("surfaces an error when request fails", async () => {
    const requestError = new Error("Failed to fetch invoices");
    const mockGet = vi.fn().mockResolvedValue({
      data: null,
      error: requestError,
    });
    const mockClient = { GET: mockGet };

    const { result } = renderHook(() => useInvoices(), {
      wrapper: createWrapper(mockClient),
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(mockGet).toHaveBeenCalledWith("/v1/invoices", {
      params: { query: { user_id: undefined } },
    });
    expect(result.current.error).toEqual(requestError);
  });
});
"""

content = content + "\n" + new_describe

with open("packages/hooks/src/use-invoices.spec.tsx", "w") as f:
    f.write(content)
