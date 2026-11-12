"use client";

/**
 * Voice and audio, in personal Settings (#3866 prototype; Shawn, 2026-11-12).
 * See `lib/voice/flag.ts`.
 *
 * Modelled on Discord's Voice & Video settings, Slack's Audio & video
 * preferences and Zoom's Audio settings: pick the microphone and speakers,
 * test the microphone against a live level meter and hear yourself back, play
 * a test sound, and the browser's own voice processing. Kept on this browser
 * (`voice-prefs.ts`), so the hint says so. Push-to-talk, a manual sensitivity
 * threshold and per-person volume are left for later.
 */

import { Play, Square } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ProfileSection } from "@/components/profile/profile-section";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { createLevelMeter } from "@/lib/voice/voice-mesh";
import {
  applyOutput,
  audioConstraints,
  canChooseOutput,
  readVoicePrefs,
  useVoicePrefs,
  writeVoicePrefs,
} from "@/lib/voice/voice-prefs";

const DEFAULT = "default-device";
const noSubscription = () => () => {};

function useDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [labelled, setLabelled] = useState(true);
  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const list = await navigator.mediaDevices.enumerateDevices();
    setDevices(list);
    // Names stay blank until the site has microphone permission.
    setLabelled(list.some((d) => d.kind === "audioinput" && d.label !== ""));
  }, []);
  useEffect(() => {
    // Read once on mount, then on every plug and unplug.
    const initial = window.setTimeout(() => void refresh(), 0);
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () => {
      window.clearTimeout(initial);
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
    };
  }, [refresh]);
  return { devices, labelled, refresh };
}

function DevicePicker({
  id,
  label,
  kind,
  devices,
  value,
  onChange,
}: {
  id: string;
  label: string;
  kind: MediaDeviceKind;
  devices: MediaDeviceInfo[];
  value: string | null;
  onChange: (deviceId: string | null) => void;
}) {
  const options = devices.filter(
    (d) => d.kind === kind && d.deviceId !== "default" && d.deviceId !== "",
  );
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value ?? DEFAULT}
        onValueChange={(next) => onChange(next === DEFAULT ? null : next)}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT}>System default</SelectItem>
          {options.map((d, index) => (
            <SelectItem key={d.deviceId} value={d.deviceId}>
              {d.label || `${label} ${index + 1}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** A live input meter, Slack's mic check; "Hear yourself" is Discord's Let's Check. */
function MicTest() {
  const prefs = useVoicePrefs();
  const [testing, setTesting] = useState(false);
  const [hearSelf, setHearSelf] = useState(false);
  const [level, setLevel] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    setTesting(false);
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    setProblem(null);
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints(readVoicePrefs()),
        video: false,
      });
      setTesting(true);
    } catch {
      setProblem(
        "Frapp can't use your microphone. Allow it in the browser's site settings and try again.",
      );
    }
  }, []);

  useEffect(() => {
    if (!testing || !streamRef.current) return;
    const context = new AudioContext();
    const meter = createLevelMeter(context, streamRef.current);
    const timer = window.setInterval(() => setLevel(meter.read()), 60);
    return () => {
      window.clearInterval(timer);
      meter.dispose();
      void context.close();
    };
  }, [testing]);

  // Hear yourself: play the microphone back through the chosen speakers.
  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    element.srcObject = testing && hearSelf ? streamRef.current : null;
    applyOutput(element, prefs.outputDeviceId);
    if (testing && hearSelf) void element.play().catch(() => {});
  }, [testing, hearSelf, prefs.outputDeviceId]);

  useEffect(() => stop, [stop]);

  // Loudness is an RMS of roughly 0..0.3 for speech; stretch it across the bar.
  const percent = Math.min(100, Math.round((level / 0.25) * 100));
  return (
    <div className="space-y-3" data-voice-mic-test="">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          onClick={testing ? stop : () => void start()}
        >
          {testing ? (
            <Square className="h-4 w-4" aria-hidden />
          ) : (
            <Play className="h-4 w-4" aria-hidden />
          )}
          {testing ? "Stop test" : "Test microphone"}
        </Button>
        <div className="flex items-center gap-2">
          <Switch
            id="voice-hear-self"
            checked={hearSelf}
            onCheckedChange={setHearSelf}
          />
          <Label htmlFor="voice-hear-self">Hear yourself</Label>
        </div>
      </div>
      <div
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 w-full overflow-hidden rounded-full bg-card"
      >
        <div
          className="h-full rounded-full bg-success transition-[width] duration-75"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        {problem ??
          (testing
            ? "Say something. The bar moves while Frapp hears you."
            : "Start a test, then talk. Use headphones with Hear yourself, or you'll get feedback.")}
      </p>
      <audio ref={audioRef} hidden />
    </div>
  );
}

/** Zoom's speaker test: a short two-note chime through the chosen output. */
function playTestSound(outputDeviceId: string | null) {
  const context = new AudioContext();
  const destination = context.createMediaStreamDestination();
  const gain = context.createGain();
  gain.gain.value = 0.15;
  gain.connect(destination);
  const now = context.currentTime;
  for (const [index, frequency] of [660, 880].entries()) {
    const tone = context.createOscillator();
    tone.frequency.value = frequency;
    tone.connect(gain);
    tone.start(now + index * 0.25);
    tone.stop(now + index * 0.25 + 0.22);
  }
  const element = new Audio();
  element.srcObject = destination.stream;
  applyOutput(element, outputDeviceId);
  void element.play().catch(() => {});
  window.setTimeout(() => {
    element.srcObject = null;
    void context.close();
  }, 800);
}

export function VoiceSettingsSection() {
  const prefs = useVoicePrefs();
  const { devices, labelled, refresh } = useDevices();
  // Read after hydration: the server can't know what this browser supports.
  const outputChoice = useSyncExternalStore(
    noSubscription,
    canChooseOutput,
    () => false,
  );

  const allowNames = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
    } finally {
      await refresh();
    }
  };

  return (
    <div className="space-y-10" data-voice-settings="">
      <ProfileSection
        id="voice-devices"
        title="Voice and audio"
        hint="Applies on this browser. Changes reach a call you're in straight away."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <DevicePicker
            id="voice-input"
            label="Microphone"
            kind="audioinput"
            devices={devices}
            value={prefs.inputDeviceId}
            onChange={(id) => writeVoicePrefs({ inputDeviceId: id })}
          />
          {outputChoice ? (
            <DevicePicker
              id="voice-output"
              label="Speakers"
              kind="audiooutput"
              devices={devices}
              value={prefs.outputDeviceId}
              onChange={(id) => writeVoicePrefs({ outputDeviceId: id })}
            />
          ) : (
            <div className="grid gap-2">
              <Label>Speakers</Label>
              <p className="text-sm text-muted-foreground">
                This browser plays calls through your computer&apos;s sound
                output. Change it in your system settings.
              </p>
            </div>
          )}
        </div>
        {!labelled ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted-foreground">
              Your devices show by name once Frapp can use the microphone.
            </p>
            <Button variant="ghost" size="sm" onClick={() => void allowNames()}>
              Allow microphone
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="ghost"
            onClick={() => playTestSound(prefs.outputDeviceId)}
          >
            Play test sound
          </Button>
        </div>
      </ProfileSection>

      <ProfileSection
        id="voice-mic-test"
        title="Microphone test"
        hint="Check you're heard before you join."
      >
        <MicTest />
      </ProfileSection>

      <ProfileSection id="voice-processing" title="Voice processing">
        <div className="space-y-4">
          {(
            [
              [
                "voice-noise",
                "Noise suppression",
                "Cuts fans, keyboards and room noise.",
                prefs.noiseSuppression,
                (on: boolean) => writeVoicePrefs({ noiseSuppression: on }),
              ],
              [
                "voice-echo",
                "Echo cancellation",
                "Stops others hearing themselves through your speakers.",
                prefs.echoCancellation,
                (on: boolean) => writeVoicePrefs({ echoCancellation: on }),
              ],
              [
                "voice-join-muted",
                "Join voice muted",
                "Start every voice chat with your microphone off.",
                prefs.joinMuted,
                (on: boolean) => writeVoicePrefs({ joinMuted: on }),
              ],
            ] as const
          ).map(([id, label, hint, checked, onChange]) => (
            <div key={id} className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <Label htmlFor={id}>{label}</Label>
                <p className="text-sm text-muted-foreground">{hint}</p>
              </div>
              <Switch id={id} checked={checked} onCheckedChange={onChange} />
            </div>
          ))}
        </div>
      </ProfileSection>
    </div>
  );
}
