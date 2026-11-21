// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Google's two browser libraries, faked: the sign-in's token client and the
 * picker, so each branch of `google-drive-picker.ts` runs without Google.
 */
type TokenConfig = {
  callback: (response: Record<string, unknown>) => void;
  error_callback?: (error: { type?: string }) => void;
};
type PickerCallback = (data: Record<string, unknown>) => void;

const CONFIG = {
  client_id: "661618060468-abc.apps.googleusercontent.com",
  api_key: "AIza-picker",
  app_id: "661618060468",
};

let tokenReply: (config: TokenConfig) => void;
let pickerReply: (callback: PickerCallback) => void;
let gapiLoad: (config: {
  callback: () => void;
  onerror: () => void;
  ontimeout: () => void;
}) => void;
const requestAccessToken = vi.fn();
const builder = {
  addView: vi.fn(),
  setOAuthToken: vi.fn(),
  setDeveloperKey: vi.fn(),
  setAppId: vi.fn(),
  setTitle: vi.fn(),
  setCallback: vi.fn(),
  build: vi.fn(),
};

function installGoogle() {
  const view = {
    setIncludeFolders: () => view,
    setSelectFolderEnabled: () => view,
    setMimeTypes: () => view,
    setEnableDrives: () => view,
  };
  let callback: PickerCallback = () => undefined;
  for (const key of Object.keys(builder) as (keyof typeof builder)[]) {
    builder[key].mockImplementation(() => builder);
  }
  builder.setCallback.mockImplementation((cb: PickerCallback) => {
    callback = cb;
    return builder;
  });
  builder.build.mockImplementation(() => ({
    setVisible: () => pickerReply(callback),
  }));
  Object.assign(window, {
    google: {
      accounts: {
        oauth2: {
          initTokenClient: (config: TokenConfig) => ({
            requestAccessToken: (options: unknown) => {
              requestAccessToken(options);
              tokenReply(config);
            },
          }),
        },
      },
      picker: {
        DocsView: function DocsView() {
          return view;
        },
        PickerBuilder: function PickerBuilder() {
          return builder;
        },
        ViewId: { FOLDERS: "folders" },
        Action: { PICKED: "picked", CANCEL: "cancel" },
      },
    },
    gapi: {
      load: (_name: string, config: Parameters<typeof gapiLoad>[0]) =>
        gapiLoad(config),
    },
  });
}

async function load() {
  vi.resetModules();
  return import("./google-drive-picker");
}

describe("pickDriveFolder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Each <script> Google's libraries come from "loads" at once.
    vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      queueMicrotask(() =>
        (node as HTMLScriptElement).onload?.(new Event("load")),
      );
      return node;
    });
    installGoogle();
    gapiLoad = (config) => config.callback();
    tokenReply = (config) =>
      config.callback({ access_token: "token-1", expires_in: 3599 });
    pickerReply = (callback) => {
      // Google calls back once as the picker opens, before anything is picked.
      callback({ action: "loaded" });
      callback({
        action: "picked",
        docs: [{ id: "folder-9", name: "Chapter Drive" }],
      });
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("signs in for drive.file, then returns the picked folder with the token", async () => {
    const { pickDriveFolder } = await load();
    await expect(pickDriveFolder(CONFIG)).resolves.toEqual({
      id: "folder-9",
      name: "Chapter Drive",
      accessToken: "token-1",
    });
    expect(builder.setOAuthToken).toHaveBeenCalledWith("token-1");
    expect(builder.setDeveloperKey).toHaveBeenCalledWith("AIza-picker");
    expect(builder.setAppId).toHaveBeenCalledWith("661618060468");
  });

  it("answers null when the officer cancels the picker", async () => {
    pickerReply = (callback) => callback({ action: "cancel" });
    const { pickDriveFolder } = await load();
    await expect(pickDriveFolder(CONFIG)).resolves.toBeNull();
  });

  it("answers null when the officer closes Google's sign-in window", async () => {
    tokenReply = (config) => config.error_callback?.({ type: "popup_closed" });
    const { pickDriveFolder } = await load();
    await expect(pickDriveFolder(CONFIG)).resolves.toBeNull();
    expect(builder.build).not.toHaveBeenCalled();
  });

  it("says a blocked sign-in window was blocked", async () => {
    tokenReply = (config) =>
      config.error_callback?.({ type: "popup_failed_to_open" });
    const { pickDriveFolder } = await load();
    await expect(pickDriveFolder(CONFIG)).rejects.toThrow(/blocked/);
  });

  it("reuses a live sign-in, until a refusal forgets it and asks with the account chooser", async () => {
    const { pickDriveFolder, forgetDrivePickerSignIn } = await load();
    await pickDriveFolder(CONFIG);
    await pickDriveFolder(CONFIG);
    expect(requestAccessToken).toHaveBeenCalledTimes(1);
    expect(requestAccessToken).toHaveBeenLastCalledWith({ prompt: "" });

    forgetDrivePickerSignIn();
    await pickDriveFolder(CONFIG);
    expect(requestAccessToken).toHaveBeenCalledTimes(2);
    expect(requestAccessToken).toHaveBeenLastCalledWith({
      prompt: "select_account",
    });
  });

  it("fails, rather than waiting for ever, when the picker module won't load, and can try again", async () => {
    gapiLoad = (config) => config.ontimeout();
    const { pickDriveFolder } = await load();
    await expect(pickDriveFolder(CONFIG)).rejects.toThrow(
      /Couldn't load Google's folder picker/,
    );
    gapiLoad = (config) => config.callback();
    await expect(pickDriveFolder(CONFIG)).resolves.toMatchObject({
      id: "folder-9",
    });
  });
});
