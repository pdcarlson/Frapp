# Mobile creation/edit flow patterns for Signet: per-flow recommendations for Expo Router

**Bottom line up front:** Not every Signet flow should become a modal — the correct answer is a mix. Use **`@gorhom/bottom-sheet` v5** as the sheet container for the three flows that genuinely need a form (task creation, service-hours logging, document upload), keep **event RSVP and poll vote as inline one-tap actions with no sheet at all**, use **React Native's native `Alert.alert` with a `destructive` button** for delete confirmations, and **defer/keep admin event creation web-only** (or, if built, make it a full-screen Expo Router modal route, not a sheet). This mirrors how the strongest mobile apps split their create flows: Todoist and Google Calendar use a bottom-sheet/quick-add composer for lightweight creation, while Linear explicitly offers a compact modal for quick issues and a **separate full-screen mode for complex ones** [linear](https://linear.app/docs/creating-issues). Below is the framework, the library decision, and the concrete per-flow spec.

## Per-flow recommendation summary

| Flow | Pattern | Container / approach | Keyboard handling |
|---|---|---|---|
| Task create (title, assignee, due, points) | **Bottom sheet** | gorhom `BottomSheetModal`, `fitToContents`/mid detent | `BottomSheetTextInput` + keyboard-controller |
| Service-hours log (hours, desc, proof image) | **Tall bottom sheet** (near-full) | gorhom `BottomSheetModal` + `BottomSheetScrollView`, high detent | keyboard-controller aware scroll |
| Event RSVP (status change) | **Inline one-tap** — no modal | Segmented control on card, optimistic | none |
| Document/backwork upload (file + metadata) | **Bottom sheet** | gorhom sheet, `expo-document-picker` from a button | `BottomSheetTextInput` for metadata |
| Poll vote (single selection) | **Inline one-tap** — no modal | `Pressable` option row, optimistic | none |
| Event *creation* (9-field, admin) | **Defer / web-only**; if built, full-screen route | Expo Router `presentation: 'modal'` | standard route form |

## The decision framework: sheet vs. full-screen vs. inline

There is **no widely-cited hard field-count threshold** (e.g. "≤3 fields → sheet") in authoritative design guidance — I looked specifically and it doesn't exist. The credible thresholds are height-based and task-commitment-based:

- **Material's 50% rule:** a modal bottom sheet's initial position is capped at ~50% of screen height; if content exceeds that, it can be dragged toward full screen with internal scrolling [material](https://m2.material.io/components/sheets-bottom). This is the practical trigger for "this form is too big for a compact sheet."
- **Task-commitment rule:** avoid a bottom sheet when the user *must complete the task before continuing* — use a full-screen modal or a new route instead [reactnativerelay](https://reactnativerelay.com/article/react-native-bottom-sheet-tutorial-gorhom-reanimated-expo-2026). Bottom sheets are for secondary/supplementary tasks that can be dismissed to interact with underlying content [nngroup](https://www.nngroup.com/articles/bottom-sheet/).
- **Don't open tall sheets full-screen on mount:** Material explicitly warns against making a bottom sheet full-screen on open because it pushes top content out of thumb reach [material](https://m2.material.io/components/sheets-bottom). Prefer a mid detent that the user can drag up.

**How strong apps apply this on the phone specifically:**
- **Todoist** uses a **quick-add composer** reached via a draggable "Dynamic Add" button — you type the task name and optionally add date/assignee/priority inline, then tap send [todoist](https://www.todoist.com/help/articles/use-the-dynamic-add-button-in-todoist-ysybl2M1). This is the model for Signet's task creation.
- **Google Calendar (Android)** slides up a **bottom sheet** from the FAB with the key fields (title, time range, attendees, location) rather than a full-screen form [9to5google](https://9to5google.com/2019/05/16/google-calendar-bottom-sheet/).
- **Linear** deliberately splits by complexity: `C` opens a **compact issue-creation modal**, `V` opens **full-screen mode** [linear](https://linear.app/docs/creating-issues) — direct precedent for keeping Signet's simple task create as a sheet and admin event creation as a full-screen route.
- **Notion** splits by surface: a database "New" opens a **modal record**, but a table/list uses an **inline `+ New` row** [notion](https://www.notion.com/help/intro-to-databases) — precedent for keeping trivial actions inline.

## Library choice: `@gorhom/bottom-sheet` v5 is the 2025-2026 default, with Expo Router `formSheet` as the lightweight alternative

The evidence points clearly to **`@gorhom/bottom-sheet` v5** as the default sheet container when you need real form UX inside: it's the most feature-complete maintained option, advertises "seamless keyboard handling" and Expo compatibility, and is **actively maintained** (v5 is the maintained line; v4 is explicitly "not maintained"; releases continue through 2025-2026) [github](https://github.com/gorhom/react-native-bottom-sheet). v5 is built on Reanimated 3 + Gesture Handler 2, and third-party 2026 guidance reports first-class New Architecture/Fabric support [reactnativerelay](https://reactnativerelay.com/article/react-native-bottom-sheet-tutorial-gorhom-reanimated-expo-2026). There is some New-Architecture issue churn (e.g. first-mount lag reports) but no evidence it's broken [github](https://github.com/gorhom/react-native-bottom-sheet/issues/2046).

The two alternatives and why they're secondary for Signet:
- **Expo Router `presentation: 'formSheet'`** gives OS-native sheet *routes* with detents (`sheetAllowedDetents` as fractions or `'fitToContents'`, `sheetInitialDetentIndex`, `sheetCornerRadius`) and an **iOS-only grabber** (`sheetGrabberVisible`) [expo](https://docs.expo.dev/router/advanced/modals/). It's the right choice when you want a navigation-integrated sheet with fewer moving parts, but it exposes fewer styling/gesture hooks and the grabber isn't available on Android.
- **`react-native-true-sheet`** is fully native (Fabric-only, requires New Architecture) but **caps at 3 detents** and uses an imperative `present()/dismiss()` model [github](https://github.com/lodev09/react-native-true-sheet) [github](https://github.com/lodev09/react-native-true-sheet/blob/main/docs/docs/reference/01-configuration.mdx). Not worth the constraints here.

**Gesture config to hand the coding agent (gorhom):** control detents with `snapPoints`; enable drag-to-dismiss with `enablePanDownToClose`; add a `BottomSheetBackdrop` with `pressBehavior="close"` for tap-outside dismiss; override the handle via `handleComponent` if needed [gorhom](https://gorhom.dev/react-native-bottom-sheet/props) [gorhom](https://gorhom.dev/react-native-bottom-sheet/components/bottomsheetbackdrop).

### NativeWind note (affects the still-open adopt-NativeWind decision)

**The recommended sheet approach has a mild preference *against* relying on NativeWind for the sheet chrome.** There is a reported friction where `className` on gorhom's `<BottomSheetView>` does not apply styles [github](https://github.com/gorhom/react-native-bottom-sheet/issues/1809), while gorhom's own `backgroundStyle`/`handleStyle`/`handleIndicatorStyle` props are StyleSheet-based [gorhom](https://ui.gorhom.dev/components/bottom-sheet/props/). Expo Router `formSheet` chrome is likewise styled through navigation options (`sheetCornerRadius`, etc.), not `className`, and NativeWind support for that chrome is unverified [expo](https://docs.expo.dev/router/advanced/modals/). *Recommendation:* style the **sheet container/chrome with typed StyleSheet tokens** regardless of the broader NativeWind decision; NativeWind (if adopted) can still style ordinary content *inside* the sheet. This is single-sourced on the gorhom `className` bug, so confidence is moderate — but it argues for not making NativeWind a hard dependency of the modal layer. (Third-party wrappers like gluestack-ui do claim NativeWind support over gorhom [gluestack](https://gluestack.io/ui/docs/components/bottomsheet), but adopting a wrapper adds its own dependency.)

## Keyboard handling for forms inside a partial-height sheet

This is the hardest part and the one most likely to break if handled naively — a `BottomSheetScrollView` with a focused input can be **completely covered by the keyboard on Android** even with the obvious props set [github](https://github.com/gorhom/react-native-bottom-sheet/issues/2674). The 2025 recommended pattern:

1. **Use `BottomSheetTextInput`, not a raw `TextInput`,** for every field in the sheet — it integrates with the library's focus/blur keyboard coordination [rorklab](https://rorklab.net/en/articles/rork-dev/rork-bottom-sheet-gorhom-implementation-guide). If you must use a custom input, you have to copy the coordination handlers from `BottomSheetTextInput` [deepwiki](https://deepwiki.com/gorhom/react-native-bottom-sheet/6.3-advanced-examples).
2. **Set the sheet's keyboard props:** `keyboardBehavior="interactive"` (note: interactive is effectively iOS-only), `keyboardBlurBehavior="restore"`, and `android_keyboardInputMode="adjustResize"` [gorhom](https://gorhom.dev/react-native-bottom-sheet/props). On Expo Android also set `softwareKeyboardLayoutMode: "resize"` in `app.json` [rorklab](https://rorklab.net/en/articles/rork-dev/rork-bottom-sheet-gorhom-implementation-guide).
3. **For robust cross-platform behavior, integrate `react-native-keyboard-controller`.** Its docs show composing a `BottomSheetKeyboardAwareScrollView` via gorhom's `createBottomSheetScrollableComponent(..., KeyboardAwareScrollView)` [kirillzyusko](https://kirillzyusko.github.io/react-native-keyboard-controller/docs/api/components/keyboard-aware-scroll-view). This is the most reliable fix for the Android "keyboard covers input" bug.
4. **Promote to full-screen when the form is tall.** Apply the 50% / task-commitment rules above; the service-hours form (long description + image) is the borderline case — use a **high single detent (near-full)** rather than a mid sheet.

## Destructive-action confirmation: native `Alert.alert`, not a custom sheet

The idiomatic replacement for the web's `window.confirm` is React Native's built-in **`Alert.alert`** with a `destructive`-styled button and a `cancel` button [reactnative](https://reactnative.dev/docs/alert). This matches platform expectations: Apple's HIG says destructive actions should use Destructive styling with a bold default Cancel so users can safely opt out [apple](https://developers.apple.com/design/human-interface-guidelines/components/presentation/alerts/). A custom themed sheet is **not** worth building for confirmations — it adds surface area for no UX gain. For destructive *choices* among options (rare in Signet), `ActionSheetIOS.showActionSheetWithOptions` with `destructiveButtonIndex` is the native alternative on iOS [github](https://github.com/facebook/react-native-website/blob/main/docs/actionsheetios.md).

Note one important nuance for reversible deletes: NN/G and Apple both favor **undo over confirmation** for reversible actions [nngroup](https://www.nngroup.com/articles/confirmation-dialog/) — Apple Reminders deletes on swipe with immediate undo [apple](https://support.apple.com/guide/iphone/delete-and-recover-reminders-iph51b488c05/ios). Reserve the blocking `Alert` for genuinely irreversible actions (e.g. deleting a chapter document); use a snackbar-with-undo for reversible ones.

## Quick actions: keep RSVP and poll vote out of any modal

Two Signet flows should have **no sheet whatsoever** — forcing them into a modal would be an anti-pattern. Strong apps do these as one-gesture actions: Todoist completes tasks via a tap on the circle or a swipe [todoist](https://www.todoist.com/inspiration/how-to-use-todoist-effectively), and its swipe actions (complete/schedule/delete) are direct, no editor [todoist](https://todoist.com/help/articles/how-to-change-your-swipe-actions).

- **Event RSVP:** a segmented control / `Pressable` status toggle directly on the event card. `Pressable.onPress` fires the mutation optimistically [reactnative](https://reactnative.dev/docs/pressable) — flip instantly, revert on failure (consistent with Signet's existing optimistic-update decision for RSVP).
- **Poll vote:** a single tap on the option row via `Pressable`, optimistic. No confirmation, no sheet.
- **Optional swipe-to-complete for tasks:** if you want a fast-path to complete a task without opening its sheet, use `ReanimatedSwipeable` from `react-native-gesture-handler` with `renderRightActions` and `onSwipeableOpen` to fire the completion [swmansion](https://docs.swmansion.com/react-native-gesture-handler/docs/components/reanimated_swipeable/). This complements — doesn't replace — the create sheet.

## Applying it to Signet's flows (concrete build spec)

**Task creation → gorhom bottom sheet.** ~4 fields but only the title is a real text input; assignee/due-date/points are pickers that don't fight the keyboard. Use a `BottomSheetModal` opened via `present()`, detent `fitToContents` or a mid snap point, `BottomSheetTextInput` for the title, `enablePanDownToClose`, backdrop `pressBehavior="close"`. This is Signet's Todoist-style quick-add.

**Service-hours logging → tall gorhom sheet.** Hours + a potentially long description + a proof image push this past the 50% line, so open at a **high single detent** with `BottomSheetScrollView` (wrapped for keyboard-controller). Trigger `expo-image-picker.launchImageLibraryAsync` from an in-sheet button — the picker is system UI that must launch from the user's tap, which a button press satisfies [expo](https://docs.expo.dev/versions/latest/sdk/imagepicker/). Result URI comes back at `result.assets[0].uri`. This is the one flow to watch for keyboard coverage; the keyboard-controller integration is mandatory here.

**Event RSVP → inline, no modal** (see above).

**Document/backwork upload → gorhom bottom sheet.** Launch `expo-document-picker.getDocumentAsync` (with a `type` MIME filter; `copyToCacheDirectory` default true) from a button in the sheet [expo](https://docs.expo.dev/versions/latest/sdk/document-picker/), then a couple of `BottomSheetTextInput` metadata fields. Medium detent.

**Poll vote → inline, no modal** (see above).

**Event creation (admin, 9 fields) → keep web-only or defer; if built, full-screen route.** This is the correct call: it's admin-only, complex, and a task the user must complete — exactly the "full-screen, not a sheet" case per both the task-commitment rule [reactnativerelay](https://reactnativerelay.com/article/react-native-bottom-sheet-tutorial-gorhom-reanimated-expo-2026) and Linear's own complex-issue full-screen mode [linear](https://linear.app/docs/creating-issues). If/when it comes to mobile, build it as an Expo Router route with `presentation: 'modal'`, not a bottom sheet.

## Where more research would change the conclusion

Two areas would most strengthen this: (1) **the gorhom + NativeWind friction is single-sourced** (one GitHub issue) — if the team leans toward adopting NativeWind broadly, a quick hands-on spike styling a `BottomSheetView` with `className` on the current NativeWind/gorhom versions would confirm whether typed StyleSheet tokens are truly required for the sheet chrome. (2) **The service-hours keyboard-coverage case on Android** is the highest-risk implementation detail; a prototype validating the `react-native-keyboard-controller` + `createBottomSheetScrollableComponent` integration against a tall form would de-risk it before committing the pattern across all three form flows.